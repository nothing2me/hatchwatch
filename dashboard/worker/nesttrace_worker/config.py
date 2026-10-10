import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    web_url: str
    token: str
    model_path: str


def load_config(env: dict[str, str] | None = None) -> Config:
    env = os.environ if env is None else env
    token = env.get('WORKER_TOKEN', '').strip()
    if not token:
        raise SystemExit('WORKER_TOKEN is not set; live detection stays off (dashboard/README.md, "Live detection").')
    return Config(
        web_url=env.get('WEB_URL', 'http://web:3000').rstrip('/'),
        token=token,
        model_path=env.get('MODEL_PATH', '/app/models/yolox_nano.onnx'),
    )
