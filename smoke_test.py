"""Smoke test: auth, connect, exercise the MCP tool functions end-to-end.

Run from the project root:
    d:/Code/Control4/.venv/Scripts/python.exe smoke_test.py
"""

from __future__ import annotations

import asyncio
import json

from control4_mcp import server as s


async def main() -> None:
    print(f"director ip: {s._settings.director_ip}")
    print(f"account:     {s._settings.account_email}")
    print(f"controller:  {s._settings.controller_common_name or '(auto)'}")

    try:
        print("\n[1/5] list_rooms...")
        rooms = await s.list_rooms()
        print(f"      {len(rooms)} room(s)")
        for r in rooms[:5]:
            print(f"        {r['id']:>5}  {r['name']!r}  floor={r.get('floorName')!r}")
        if len(rooms) > 5:
            print(f"        ... ({len(rooms) - 5} more)")

        print("\n[2/5] list_items(category='lights')...")
        lights = await s.list_items(category="lights")
        print(f"      {len(lights)} light(s)")
        for x in lights[:5]:
            print(f"        {x['id']:>5}  {x['name']!r}  room={x.get('roomName')!r}")

        print("\n[3/5] find_items('master')...")
        found = await s.find_items(query="master")
        print(f"      {len(found)} match(es)")
        for x in found[:5]:
            print(f"        {x['id']:>5}  {x['name']!r}  type={x.get('typeName')!r}")

        sample_light = next((x for x in lights if x["name"]), None)
        if sample_light:
            print(f"\n[4/5] get_item_variables({sample_light['id']}) — {sample_light['name']!r}...")
            variables = await s.get_item_variables(item_id=sample_light["id"])
            print(json.dumps(variables, indent=2, default=str)[:600])

        print("\n[5/5] list_items(category='comfort')...")
        comfort = await s.list_items(category="comfort")
        print(f"      {len(comfort)} comfort item(s)")
        for x in comfort[:5]:
            print(f"        {x['id']:>5}  {x['name']!r}  room={x.get('roomName')!r}")

        print("\nall good.")
    finally:
        await s._conn.close()


if __name__ == "__main__":
    asyncio.run(main())
