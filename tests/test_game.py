import time
import unittest
from fastapi.testclient import TestClient
from server.main import app, rooms, queue
from server.game_logic import generate_ip, validate


def until(ws, kind):
    for _ in range(30):
        event = ws.receive_json()
        if event['type'] == kind:
            return event
    raise AssertionError(f'Missing {kind}')


class GameTests(unittest.TestCase):
    def setUp(self):
        rooms.clear()
        queue.clear()

    def test_validation(self):
        self.assertEqual(validate([0, 1, 128, 255], ['00000000', '00000001', '10000000', '11111111']), [True] * 4)
        self.assertEqual(validate([0, 1, 128, 255], ['0', '00000002', None, '11111111']), [False, False, False, True])
        self.assertEqual(validate([0] * 4, '0000'), [False] * 4)
        previous = None
        for _ in range(100):
            ip = generate_ip(previous)
            self.assertNotEqual(ip, previous)
            self.assertTrue(all(0 <= n <= 255 for n in ip))
            previous = ip

    def test_site(self):
        with TestClient(app) as client:
            self.assertEqual(client.get('/').status_code, 200)
            self.assertEqual(client.get('/static/js/game.js').status_code, 200)

    def test_match_and_reconnect(self):
        with TestClient(app) as client:
            with client.websocket_connect('/ws/matchmaking') as q1, client.websocket_connect('/ws/matchmaking') as q2:
                q1.send_json({'type': 'join_queue', 'player_name': 'Alice'})
                q2.send_json({'type': 'join_queue', 'player_name': 'Bob'})
                p1, p2 = until(q1, 'match_found'), until(q2, 'match_found')
                self.assertEqual(p1['room'], p2['room'])
                path1 = f"/ws/match/{p1['room']}?token={p1['token']}"
                path2 = f"/ws/match/{p2['room']}?token={p2['token']}"
                with client.websocket_connect(path1) as a, client.websocket_connect(path2) as b:
                    state = until(a, 'state')
                    self.assertNotIn(p2['token'], str(state))
                    a.send_json({'type': 'ready'}); b.send_json({'type': 'ready'})
                    until(a, 'countdown_start'); until(b, 'countdown_start')
                    state = until(a, 'state'); other = until(b, 'state')
                    # b initially receives its waiting state before the countdown.
                    if other['status'] != 'playing': other = until(b, 'state')
                    self.assertEqual(state['ip'], other['ip'])
                    a.send_json({'type': 'submit_answer', 'round': 0, 'octets': ['00000000'] * 4})
                    self.assertEqual(until(a, 'state')['round'], 1)
                    a.send_json({'type': 'submit_answer', 'round': 1, 'octets': ['bad'] * 4})
                    self.assertEqual(until(a, 'submission_result')['correct'], [False] * 4)
                    a.send_json({'type': 'submit_answer', 'round': 1, 'octets': ['bad'] * 4})
                    self.assertEqual(until(a, 'rate_limited')['type'], 'rate_limited')
                    time.sleep(.21)
                    for number in range(1, 6):
                        a.send_json({'type': 'submit_answer', 'round': number, 'octets': [format(n, '08b') for n in state['ip']]})
                        self.assertTrue(all(until(a, 'submission_result')['correct']))
                        won = until(a, 'round_won')
                        self.assertEqual(won['wins'][p1['player_id']], number)
                        if number < 5: state = until(a, 'state')
                    self.assertEqual(until(a, 'match_over')['winner'], p1['player_id'])
                    self.assertEqual(until(b, 'match_over')['winner'], p1['player_id'])
                    self.assertEqual(len(rooms), 0)

    def test_reconnect_and_forfeit(self):
        with TestClient(app) as client:
            with client.websocket_connect('/ws/matchmaking') as q1, client.websocket_connect('/ws/matchmaking') as q2:
                for q in [q1, q2]: q.send_json({'type': 'join_queue', 'player_name': 'Test'})
                p1, p2 = until(q1, 'match_found'), until(q2, 'match_found')
                path = lambda p: f"/ws/match/{p['room']}?token={p['token']}"
                with client.websocket_connect(path(p2)) as b:
                    with client.websocket_connect(path(p1)) as a:
                        until(a, 'state')
                    until(b, 'opponent_disconnected')
                    with client.websocket_connect(path(p1)) as restored:
                        self.assertEqual(until(restored, 'state')['round'], 1)
                        restored.send_json({'type': 'leave_match'})
                        self.assertEqual(until(b, 'match_over')['winner'], p2['player_id'])


if __name__ == '__main__':
    unittest.main()
