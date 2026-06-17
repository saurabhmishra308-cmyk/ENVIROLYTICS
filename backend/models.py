from pydantic import BaseModel, Field, EmailStr
from typing import Optional, Literal
from datetime import datetime
from enum import Enum

class UserRole(str, Enum):
    ADMIN = "admin"
    CLIENT = "client"

class SiteStatus(str, Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    EXPIRED = "expired"

class SubscriptionType(str, Enum):
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    YEARLY = "yearly"

class User(BaseModel):
    id: str
    username: str
    email: EmailStr
    full_name: str
    role: UserRole = UserRole.CLIENT
    company_name: Optional[str] = None
    phone: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    is_active: bool = True
    
class UserCreate(BaseModel):
    username: str
    email: EmailStr
    password: str
    full_name: str
    company_name: Optional[str] = None
    phone: Optional[str] = None

class UserLogin(BaseModel):
    username: str
    password: str

class SiteActivation(BaseModel):
    user_id: str
    subscription_type: SubscriptionType
    start_date: datetime
    end_date: datetime
    status: SiteStatus = SiteStatus.ACTIVE
    auto_renewal: bool = False
    created_by: str  # Admin user ID
    
class FlowmeterReading(BaseModel):
    hardware_id: str
    timestamp: datetime
    flow_rate_lpm: float
    forward_totalizer: float
    reverse_totalizer: float
    temperature: float
    signal_strength: int
    location: Optional[str] = None
    
class DataExportRequest(BaseModel):
    format: Literal["csv", "pdf"]
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    hardware_ids: Optional[list[str]] = None
    
class CalibrationCertificate(BaseModel):
    instrument_id: str
    instrument_type: str
    serial_number: str
    calibration_date: datetime
    next_calibration_date: datetime
    calibrated_by: str
    certificate_number: str
    parameters: dict
    
class InstallationCertificate(BaseModel):
    instrument_id: str
    instrument_type: str
    serial_number: str
    installation_date: datetime
    installed_by: str
    location: str
    client_name: str
    certificate_number: str
