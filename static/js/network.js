export class Network {
  constructor(onMessage, onStatus) { this.onMessage = onMessage; this.onStatus = onStatus; this.stopped = false; }
  url(path) { return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${path}`; }
  queue(name) {
    this.stopped = false;
    this.ws = new WebSocket(this.url('/ws/matchmaking'));
    this.ws.onopen = () => this.send({ type: 'join_queue', player_name: name });
    this.ws.onmessage = e => {
      const data = JSON.parse(e.data);
      if (data.type === 'match_found') {
        this.ws.onclose = null; this.ws.close();
        this.session = data; sessionStorage.setItem('bitshift-session', JSON.stringify(data));
        this.connect();
      }
    };
    this.ws.onclose = () => { if (!this.stopped) this.onStatus('Unable to reach matchmaking. Please return to the menu and try again.'); };
  }
  connect() {
    if (this.stopped) return;
    this.ws = new WebSocket(this.url(`/ws/match/${this.session.room}?token=${encodeURIComponent(this.session.token)}`));
    this.ws.onopen = () => { this.onStatus('Connected. Waiting for both players…'); this.send({ type: 'ready' }); };
    this.ws.onmessage = e => {
      const data = JSON.parse(e.data);
      if (data.type === 'match_over') { sessionStorage.removeItem('bitshift-session'); this.stopped = true; }
      this.onMessage(data, this.session);
    };
    this.ws.onclose = e => {
      if (this.stopped) return;
      if ([4004, 4001].includes(e.code)) { this.stopped = true; sessionStorage.removeItem('bitshift-session'); this.onMessage({ type: 'expired' }); return; }
      this.onStatus('Connection lost. Reconnecting… (10-second grace period)');
      this.retry = setTimeout(() => this.connect(), 1000);
    };
  }
  send(data) { if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(data)); }
  stop() { this.send({ type: 'leave_match' }); this.stopped = true; clearTimeout(this.retry); this.ws?.close(); sessionStorage.removeItem('bitshift-session'); }
}
