from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

from fastapi import FastAPI, APIRouter
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import asyncio
import logging
from pydantic import BaseModel, Field, ConfigDict
from typing import List
import uuid
from datetime import datetime, timezone

# Import services and routers
from mqtt_service import MQTTFlowmeterService
from api_flowmeter import router as flowmeter_router
import api_flowmeter
from api_admin import router as admin_router
import api_admin
from api_auth import router as auth_router, seed_admin
import api_auth
from api_instruments import router as instruments_router
import api_instruments
from api_certificates import router as certificates_router
import api_certificates
from api_flowmeter_mgmt import router as flowmeter_mgmt_router
import api_flowmeter_mgmt
from api_audit import router as audit_router
import api_audit
import auth as auth_module


# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Initialize MQTT Service
mqtt_service = MQTTFlowmeterService(client, os.environ['DB_NAME'])
api_flowmeter.mqtt_service = mqtt_service
api_admin.db = db
api_auth.set_db(db)
api_instruments.set_db(db)
api_instruments.set_mqtt(mqtt_service)
api_certificates.set_db(db)
api_flowmeter_mgmt.set_db(db)
api_audit.set_db(db)
auth_module.set_db(db)

# Create the main app
app = FastAPI(title="Envirolytics Monitor API")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


class StatusCheck(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class StatusCheckCreate(BaseModel):
    client_name: str


@api_router.get("/")
async def root():
    return {"message": "Envirolytics Monitor API"}


@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_dict = input.model_dump()
    status_obj = StatusCheck(**status_dict)
    doc = status_obj.model_dump()
    doc['timestamp'] = doc['timestamp'].isoformat()
    await db.status_checks.insert_one(doc)
    return status_obj


@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find({}, {"_id": 0}).to_list(1000)
    for check in status_checks:
        if isinstance(check['timestamp'], str):
            check['timestamp'] = datetime.fromisoformat(check['timestamp'])
    return status_checks


# Mount routers
app.include_router(api_router)
app.include_router(auth_router)
app.include_router(flowmeter_router)
app.include_router(admin_router)
app.include_router(instruments_router)
app.include_router(certificates_router)
app.include_router(flowmeter_mgmt_router)
app.include_router(audit_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.on_event("startup")
async def startup_event():
    logger.info("Starting Envirolytics Monitor API...")
    # Seed admin user
    await seed_admin(db)
    # Register asyncio loop with MQTT service so callbacks can schedule coroutines
    mqtt_service.set_event_loop(asyncio.get_event_loop())
    # Connect to MQTT broker (non-blocking)
    mqtt_service.connect()
    logger.info("Startup complete")


@app.on_event("shutdown")
async def shutdown_db_client():
    mqtt_service.disconnect()
    client.close()
    logger.info("Services shut down")
