from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from backend.api import routes
from backend.api.stream import router as stream_router
from backend.core.launch_check import readiness_check
from backend.core.config import settings
from backend.core.security_middleware import verify_token, enforce_rate_limit, validate_runtime_security

app = FastAPI(title='DivyaOS API', version='1.2.2')
app.include_router(routes.router)
app.include_router(stream_router)

origins = [o.strip() for o in settings.allowed_origins.split(',')] if settings.allowed_origins else ['*']
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=['*'], allow_headers=['*'])

@app.middleware('http')
async def security_layer(request: Request, call_next):
    enforce_rate_limit(request)
    verify_token(request)
    response = await call_next(request)
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    return response

@app.get('/healthz')
def healthz():
    return {'status': 'ok'}

@app.get('/readyz')
def readyz():
    return readiness_check()

@app.on_event('startup')
def startup() -> None:
    validate_runtime_security()
    routes.automation.start()

@app.on_event('shutdown')
def shutdown() -> None:
    routes.automation.stop()
