# Bitshift

A keyboard-first IPv4 conversion game built with Python, FastAPI, native WebSockets, and vanilla JavaScript. Includes free play, 60 seconds per address time attack, and live first-to-five multiplayer.

## Run

Use Python 3.10 or newer:

```sh
python -m pip install -r requirements.txt
python run.py
```

Open http://localhost:8000. To play together on your local network, both players open `http://SERVER_LAN_IP:8000` and select Multiplayer. Allow port 8000 through the host firewall if needed. Two browser tabs also work for testing; enter multiplayer independently in each tab.

On this machine, dependencies have been installed into the project-local `.packages` directory. If Python is not on PATH, run:

```powershell
& "$env:USERPROFILE\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" run.py
```

## Playing

- Enter exactly eight bits per octet, including leading zeros. Input advances automatically after eight digits; Tab and Enter also work.
- Correct octets lock on a failed submission. After two incorrect submissions, solo players can reveal and skip for zero points; the previous answer stays in the feedback line.
- Every fifth consecutive solve gives a 250-point bonus and increases the multiplier: 2×, 4×, up to 128×. Incorrect submissions reset both streak and multiplier.
- Time attack resets to 60 seconds for each new address. Faster solves earn up to 100 extra base points. Pause and hidden tabs freeze solo gameplay.
- Multiplayer pairs waiting players in FIFO order. The server validates answers, rejects stale rounds, limits submissions to one per 200 ms, and awards the first valid submission. First to five wins. Disconnects have a ten-second grace period, including page refresh. Quitting forfeits immediately.
- Sound and player names persist locally. Sounds are synthesized with Web Audio; there are no audio downloads. Fonts have local system fallbacks.

## Hosting limitations

Multiplayer rooms and matchmaking live in process memory. Use **one server worker**. Restarting the server clears active matches. For internet play, deploy this ASGI application to a host with WebSocket support and HTTPS; the client automatically selects WSS. Public hosting is not configured by this project. Multiple replicas require a shared room/queue backend. Server validation prevents false answers but cannot prevent a modified client from calculating binary automatically.

## Tests

```sh
python -m unittest discover -s tests -v
```

If using project-local dependencies, set `PYTHONPATH=.packages` first. The tests cover validation, matchmaking, shared rounds, stale submissions, reconnects, first-to-five wins, and forfeits.
