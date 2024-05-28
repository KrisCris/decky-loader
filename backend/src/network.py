from aiohttp import ClientSession
from aiohttp_socks import ProxyConnector

class ProxiedClientSession(ClientSession):
    proxy_url = None
    def __init__(self, *args, **kwargs):
        if self.proxy_url:
            connector = ProxyConnector.from_url(self.proxy_url)
            super().__init__(connector=connector, *args, **kwargs)
        else:
            super().__init__(*args, **kwargs)