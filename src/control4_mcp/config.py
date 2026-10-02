"""Environment-backed configuration."""

from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Settings:
    account_email: str
    account_password: str
    director_ip: str
    controller_common_name: str | None
    # DirectorLink (formerly C4Bridge) LAN API, optional. Enabled when an API
    # key is set; the URL defaults to its fixed port on the Director.
    directorlink_url: str | None = None
    directorlink_token: str | None = None

    @classmethod
    def from_env(cls) -> "Settings":
        missing = [
            name
            for name in ("CONTROL4_ACCOUNT_EMAIL", "CONTROL4_ACCOUNT_PASSWORD", "CONTROL4_DIRECTOR_IP")
            if not os.getenv(name)
        ]
        if missing:
            raise RuntimeError(
                f"Missing required environment variables: {', '.join(missing)}. "
                "Copy .env.example to .env and fill it in."
            )
        return cls(
            account_email=os.environ["CONTROL4_ACCOUNT_EMAIL"],
            account_password=os.environ["CONTROL4_ACCOUNT_PASSWORD"],
            director_ip=os.environ["CONTROL4_DIRECTOR_IP"],
            controller_common_name=os.getenv("CONTROL4_CONTROLLER_COMMON_NAME"),
            directorlink_url=os.getenv("CONTROL4_DIRECTORLINK_URL")
            or os.getenv("CONTROL4_C4BRIDGE_URL")
            or f"http://{os.environ['CONTROL4_DIRECTOR_IP']}:41999",
            directorlink_token=os.getenv("CONTROL4_DIRECTORLINK_TOKEN")
            or os.getenv("CONTROL4_C4BRIDGE_TOKEN")
            or None,
        )
