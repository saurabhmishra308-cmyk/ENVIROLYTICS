# MongoDB Atlas Migration Guide

## Current Setup vs Production

### Local Development (Current)
```
MONGO_URL="mongodb://localhost:27017"
DB_NAME="test_database"
```

### Production (Atlas MongoDB)
```
MONGO_URL="mongodb+srv://<username>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority"
DB_NAME="envirolytics_prod"
```

## Required Changes for Atlas Deployment

### 1. Backend Environment Variables
Update `/app/backend/.env` for production:

```bash
# MongoDB Atlas Configuration
MONGO_URL="mongodb+srv://envirolytics-user:YOUR_PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority"
DB_NAME="envirolytics_production"
CORS_ORIGINS="*"

# MQTT Configuration
MQTT_BROKER_HOST="mqtt.envirolytics.in"
MQTT_BROKER_PORT="1883"
MQTT_USERNAME=""
MQTT_PASSWORD=""

# JWT Secret (CHANGE IN PRODUCTION)
JWT_SECRET_KEY="YOUR-STRONG-RANDOM-SECRET-KEY-HERE"
```

### 2. Connection String Format
Atlas uses `mongodb+srv://` protocol with:
- Built-in connection pooling
- Automatic failover
- TLS/SSL by default

### 3. Database Indexes (Create in Atlas)
```javascript
// Run these in MongoDB Atlas console
use envirolytics_production;

// Flowmeter readings index
db.flowmeter_readings.createIndex({ "hardware_id": 1, "timestamp": -1 });
db.flowmeter_readings.createIndex({ "timestamp": -1 });

// Flowmeter latest index
db.flowmeter_latest.createIndex({ "hardware_id": 1 }, { unique: true });

// User indexes
db.users.createIndex({ "username": 1 }, { unique: true });
db.users.createIndex({ "email": 1 }, { unique: true });
db.users.createIndex({ "id": 1 }, { unique: true });

// Site activation index
db.site_activations.createIndex({ "user_id": 1, "created_at": -1 });

// Gateway status index
db.gateway_latest.createIndex({ "gateway_imei": 1 }, { unique: true });

// Certificates index
db.certificates.createIndex({ "instrument_id": 1, "type": 1 });
```

### 4. Network Access
In MongoDB Atlas Console:
1. Go to Network Access
2. Add IP Address: `0.0.0.0/0` (for Kubernetes pods)
   - Or specific Kubernetes cluster IP range
3. Enable "Allow access from anywhere" temporarily for testing

### 5. Database User
In MongoDB Atlas Console:
1. Go to Database Access
2. Create user: `envirolytics-user`
3. Set strong password
4. Grant role: `readWrite` on `envirolytics_production` database

## Health Check Compatibility

The current health check endpoint `/api/` works with both local and Atlas MongoDB.

## Connection Pooling
Motor (async MongoDB driver) handles connection pooling automatically.
No code changes needed.

## Testing Atlas Connection Locally

```python
# Test script
from motor.motor_asyncio import AsyncIOMotorClient
import asyncio

async def test_atlas():
    client = AsyncIOMotorClient("mongodb+srv://user:pass@cluster.mongodb.net/")
    db = client.test_database
    
    # Test write
    result = await db.test_collection.insert_one({"test": "data"})
    print(f"Inserted: {result.inserted_id}")
    
    # Test read
    doc = await db.test_collection.find_one({"test": "data"})
    print(f"Found: {doc}")
    
    # Cleanup
    await db.test_collection.delete_one({"test": "data"})
    client.close()
    print("✓ Atlas connection successful")

asyncio.run(test_atlas())
```

## Deployment Checklist

- [ ] MongoDB Atlas cluster created
- [ ] Database user created with readWrite permission
- [ ] Network access configured (0.0.0.0/0 or cluster IPs)
- [ ] Connection string updated in backend/.env
- [ ] Database name updated
- [ ] JWT secret changed from default
- [ ] MQTT broker URL configured (if available)
- [ ] Weather API key set in frontend/.env
- [ ] Indexes created in Atlas
- [ ] Test connection before deploying
- [ ] Backend health check responding
- [ ] Frontend environment variables set

## Common Atlas Issues & Solutions

### Issue 1: "MongoServerSelectionTimeoutError"
**Cause:** Network access not configured
**Fix:** Add `0.0.0.0/0` to Atlas Network Access

### Issue 2: "Authentication failed"
**Cause:** Wrong username/password or user not created
**Fix:** Verify user exists in Database Access with correct permissions

### Issue 3: "SSL/TLS handshake failed"
**Cause:** Old MongoDB driver version
**Fix:** Ensure motor>=3.3.1 in requirements.txt (already included)

### Issue 4: "Connection refused"
**Cause:** Wrong connection string format
**Fix:** Use `mongodb+srv://` not `mongodb://` for Atlas

## Production Environment Variables

Set these in Kubernetes/Emergent deployment:

```bash
# Backend
MONGO_URL=mongodb+srv://user:pass@cluster.mongodb.net/?retryWrites=true&w=majority
DB_NAME=envirolytics_production
JWT_SECRET_KEY=your-production-secret-key
MQTT_BROKER_HOST=mqtt.envirolytics.in
MQTT_BROKER_PORT=1883

# Frontend
REACT_APP_BACKEND_URL=https://your-app-domain.com
REACT_APP_WEATHER_API_KEY=c739a0f981a6ec4c486c6fe9b25a2b92
```

## Verification Steps Post-Deployment

```bash
# 1. Check backend health
curl https://your-app-domain.com/api/

# 2. Check MQTT service status
curl https://your-app-domain.com/api/flowmeter/status

# 3. Test database connectivity
curl https://your-app-domain.com/api/status

# 4. Verify frontend loads
curl https://your-app-domain.com/
```

## Support
For Atlas-specific issues:
- MongoDB Atlas Documentation: https://docs.atlas.mongodb.com/
- Support: envirolytics.official@gmail.com
