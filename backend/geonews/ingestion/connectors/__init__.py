from geonews.ingestion.connectors.gdelt import GdeltConnector
from geonews.ingestion.connectors.html_list import HtmlListConnector
from geonews.ingestion.connectors.rss import RssConnector, YoutubeConnector
from geonews.ingestion.connectors.telegram_public import TelegramPublicConnector

CONNECTORS = {c.name: c for c in (RssConnector(), YoutubeConnector(), TelegramPublicConnector(), HtmlListConnector(),
                                  GdeltConnector())}
