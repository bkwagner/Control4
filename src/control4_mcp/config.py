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
    # C4Bridge LAN API (optional). Enabled when a token is set; the URL
    # defaults to the bridge's fixed port on the Director.
    c4bridge_url: str | None = None
    c4bridge_token: str | None = None

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
            c4bridge_url=os.getenv("CONTROL4_C4BRIDGE_URL") or f"http://{os.environ['CONTROL4_DIRECTOR_IP']}:41999",
            c4bridge_token=os.getenv("CONTROL4_C4BRIDGE_TOKEN") or None,
        )
