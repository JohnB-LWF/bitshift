import asyncio
import secrets
import time
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .game_logic import generate_ip, validate

app = FastAPI(title='Bitshift — IPv4 arena')
STATIC = Path(__file__).resolve().parent.parent / 'static'
app.mount('/static', StaticFiles(directory=STATIC), name='static')
rooms = {}
queue = []
queue_lock = asyncio.Lock()


@app.get('/')
async def index():
    return FileResponse(STATIC / 'index.html')


@app.get('/health')
async def health():
    return {'status': 'ok'}


async def send(ws, message):
    if ws:
        try:
            await ws.send_json(message)
        except (RuntimeError, WebSocketDisconnect, OSError):
            pass


class Room:
    def __init__(self, players):
        self.id = secrets.token_urlsafe(8)
        self.players = players
        self.sockets = {}
        self.ready = set()
        self.wins = {p['token']: 0 for p in players}
        self.ip = generate_ip()
        self.round = 1
        self.status = 'waiting'
        self.lock = asyncio.Lock()
        self.last_submit = {}
        self.disconnect_generation = {}
        self.tasks = set()

    def task(self, coro):
        task = asyncio.create_task(coro)
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)

    async def broadcast(self, message):
        await asyncio.gather(*(send(ws, message) for ws in list(self.sockets.values())))

    def public_id(self, token):
        return next((p['id'] for p in self.players if p['token'] == token), None)

    def public_wins(self):
        return {self.public_id(token): value for token, value in self.wins.items()}

    def state(self):
        return {'type': 'state', 'status': self.status, 'ip': self.ip if self.status == 'playing' else None,
                'round': self.round, 'wins': self.public_wins(),
                'players': [{'id': p['id'], 'name': p['name']} for p in self.players]}

    async def start(self):
        self.status = 'countdown'
        await self.broadcast({'type': 'countdown_start'})
        await asyncio.sleep(3.2)
        if self.status != 'countdown':
            return
        self.status = 'playing'
        await self.broadcast(self.state())

    async def next_round(self):
        await asyncio.sleep(.75)
        if self.status != 'transition':
            return
        self.ip = generate_ip(self.ip)
        self.round += 1
        self.status = 'playing'
        await self.broadcast(self.state())

    async def finish(self, winner, reason):
        if self.status == 'finished':
            return
        self.status = 'finished'
        await self.broadcast({'type': 'match_over', 'winner': self.public_id(winner), 'wins': self.public_wins(), 'reason': reason})
        rooms.pop(self.id, None)
        for task in list(self.tasks):
            if task is not asyncio.current_task():
                task.cancel()

    async def grace(self, token):
        generation = self.disconnect_generation.get(token, 0)
        await asyncio.sleep(10)
        async with self.lock:
            if token not in self.sockets and self.status != 'finished' and self.disconnect_generation.get(token, 0) == generation:
                other = next(p['token'] for p in self.players if p['token'] != token)
                await self.finish(other, 'Opponent disconnected')

    async def expire(self):
        await asyncio.sleep(1800)
        await self.finish(None, 'Room expired after 30 minutes')


@app.websocket('/ws/matchmaking')
async def matchmaking(ws: WebSocket):
    await ws.accept()
    entry = None
    try:
        message = await asyncio.wait_for(ws.receive_json(), 15)
        if not isinstance(message, dict) or message.get('type') != 'join_queue':
            return
        name = str(message.get('player_name', 'Player')).strip()[:20] or 'Player'
        entry = {'socket': ws, 'name': name, 'token': secrets.token_urlsafe(24)}
        async with queue_lock:
            queue.append(entry)
            if len(queue) >= 2:
                pair = [queue.pop(0), queue.pop(0)]
                room = Room([{'name': p['name'], 'token': p['token'], 'id': secrets.token_hex(8)} for p in pair])
                rooms[room.id] = room
                room.task(room.expire())
                for p in pair:
                    await send(p['socket'], {'type': 'match_found', 'room': room.id, 'token': p['token'], 'player_id': room.public_id(p['token'])})
                    room.task(room.grace(p['token']))
        while True:
            await ws.receive_text()
    except (WebSocketDisconnect, asyncio.TimeoutError, ValueError):
        pass
    finally:
        async with queue_lock:
            if entry in queue:
                queue.remove(entry)
        await send(ws, {'type': 'closed'})


@app.websocket('/ws/match/{room_id}')
async def match(ws: WebSocket, room_id: str):
    await ws.accept()
    room = rooms.get(room_id)
    token = ws.query_params.get('token')
    if not room or token not in room.wins:
        await ws.close(code=4004, reason='Match no longer available')
        return
    old = room.sockets.get(token)
    room.disconnect_generation[token] = room.disconnect_generation.get(token, 0) + 1
    room.sockets[token] = ws
    if old:
        await old.close(code=4001)
    await send(ws, room.state())
    await room.broadcast({'type': 'opponent_reconnected'})
    try:
        while True:
            raw = await ws.receive_text()
            if len(raw) > 2048:
                await ws.close(code=1009)
                break
            import json
            try:
                data = json.loads(raw)
            except ValueError:
                continue
            if not isinstance(data, dict):
                continue
            async with room.lock:
                kind = data.get('type')
                if kind == 'ready':
                    room.ready.add(token)
                    if len(room.ready) == 2 and len(room.sockets) == 2 and room.status == 'waiting':
                        room.status = 'starting'
                        room.task(room.start())
                elif kind == 'leave_match':
                    other = next(t for t in room.wins if t != token)
                    await room.finish(other, 'Opponent forfeited')
                elif kind == 'submit_answer' and room.status == 'playing':
                    if data.get('round') != room.round:
                        await send(ws, room.state())
                        continue
                    now = time.monotonic()
                    if now - room.last_submit.get(token, 0) < .2:
                        await send(ws, {'type': 'rate_limited'})
                        continue
                    room.last_submit[token] = now
                    correct = validate(room.ip, data.get('octets'))
                    await send(ws, {'type': 'submission_result', 'correct': correct, 'round': room.round})
                    if all(correct):
                        room.status = 'transition'
                        room.wins[token] += 1
                        await room.broadcast({'type': 'round_won', 'winner': room.public_id(token), 'wins': room.public_wins()})
                        if room.wins[token] >= 5:
                            await room.finish(token, 'First to five rounds')
                        else:
                            room.task(room.next_round())
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        if room.sockets.get(token) is ws:
            room.sockets.pop(token, None)
            if room.status != 'finished':
                await room.broadcast({'type': 'opponent_disconnected'})
                room.task(room.grace(token))
