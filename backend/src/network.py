import ipaddress
import socket
from urllib.parse import urlparse
from aiohttp import ClientSession, ClientResponse
from aiohttp.typedefs import StrOrURL
from yarl import URL
from aiohttp_socks import ProxyConnector, ProxyType # type: ignore
import asyncio
from typing import Any, Dict, Optional

class ProxiedClientSession(ClientSession):
    proxy_url: Optional[str] = None
    proxy_connector: Optional[ProxyConnector] = None

    async def _test_proxy(self) -> Optional[ProxyConnector]:
        if self.proxy_url:
            connector = ProxyConnector.from_url(self.proxy_url) # type: ignore
            try:
                async with ClientSession(connector=connector) as session:
                    async with session.get("https://www.google.com/") as _:
                        return connector
            except: pass
        return None
    
    def _is_local_traffic(self, url: StrOrURL) -> bool:
        hostname = url.host if isinstance(url, URL) else urlparse(url).hostname
        if hostname is None:
            return False
        try:
            ip = socket.gethostbyname(hostname)
            ip_addr = ipaddress.ip_address(ip)
            return ip_addr.is_private or ip_addr.is_loopback
        except (socket.gaierror, ValueError):
            return False

    async def _request(
        self,
        method: str,
        str_or_url: StrOrURL,
        *args: Any, 
        **kwargs: Any
    ) -> ClientResponse:
        if self.proxy_connector and not self._is_local_traffic(str_or_url):
            async with ClientSession(connector=self.proxy_connector) as session:
                return await session._request(method, str_or_url, *args, **kwargs)
        else:
            return await super()._request(method, str_or_url, *args, **kwargs)         

    def __init__(self, *args: Any, **kwargs: Dict[str, Any]):
        loop = asyncio.get_event_loop()
        self.proxy_connector = loop.run_until_complete(self._test_proxy())
        super().__init__(*args, **kwargs)