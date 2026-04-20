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
        )
