import ipaddress
import socket
from urllib.parse import urlparse
from aiohttp import BaseConnector, ClientSession, ClientResponse, TCPConnector
from aiohttp.typedefs import StrOrURL
from yarl import URL
from aiohttp_socks import ProxyConnector, ProxyType # type: ignore
from typing import Any, Optional

class ProxiedClientSession(ClientSession):
    bypass_local: bool = True
    proxy_test_url: str = 'https://api.ipify.org'
    proxy_url: Optional[str] = None
    proxy_connector: Optional[ProxyConnector] = None
    default_connector: Optional[BaseConnector] = None

    async def _try_get_proxy_connector(self) -> Optional[ProxyConnector]:
        if self.proxy_url:
            connector = ProxyConnector.from_url(self.proxy_url) # type: ignore
            try:
                async with ClientSession(connector=connector) as session:
                    async with session.get(self.proxy_test_url) as _:
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
        if self.bypass_local and self._is_local_traffic(str_or_url):
            self._connector = self.default_connector
        else:
            self._connector = await self._try_get_proxy_connector() or self.default_connector
        return await super()._request(method, str_or_url, *args, **kwargs)         

    def __init__(self, *args: Any, **kwargs: Any):
        if 'connector' not in kwargs:
            self.default_connector = TCPConnector()
            kwargs['connector'] = self.default_connector
        else:
            self.default_connector = kwargs['connector']        
        super().__init__(*args, **kwargs)