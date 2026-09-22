"""Start the single-worker development / LAN server."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / '.packages'))

if __name__ == '__main__':
    import uvicorn
    uvicorn.run('server.main:app', host='0.0.0.0', port=8000, ws_max_size=4096)
