# MQTT IoT Flowmeter Integration Guide

## Overview
This system integrates real-time data from IoT flowmeters via MQTT protocol. Data is received, parsed, stored in MongoDB, and made available through REST APIs for the frontend dashboard.

## MQTT Data Format

### Gateway Status Topic
- **Topic Format:** `{GATEWAY_IMEI}/0`
- **Example Topic:** `860560069008656/0`
- **Example Data:** `0,ON`

### Flowmeter Data Topic  
- **Topic Format:** `{HARDWARE_ID}/0`
- **Example Topic:** `4105/0`
- **Example Data:**
```json
{
  "IMEI": "862493051816688",
  "IMSI": "404980518652835",
  "SIGNAL": "28",
  "TIME": "260517153808",
  "FLOW": "0.00",
  "TOT1": "39959.00",
  "TOT2": "25.00",
  "RTOT1": "18.00",
  "RTOT2": "0.00",
  "UNT": "2",
  "POW": "1",
  "TEMPER": "0",
  "VER": "14"
}
```

## Data Processing

### Calculations
- **Forward Totalizer:** `(TOT2 × 65535) + TOT1`
- **Reverse Totalizer:** `(RTOT2 × 65535) + RTOT1`
- **Flow Rate Conversion:** LPH → LPM (divide by 60)

### Unit Codes
| Code | Unit | Description |
|------|------|-------------|
| 1 | L/S | Liters per Second |
| 2 | L/M | Liters per Minute |
| 3 | L/H | Liters per Hour |
| 4 | M3/S | Cubic Meters per Second |
| 5 | M3/M | Cubic Meters per Minute |
| 6 | M3/H | Cubic Meters per Hour |
| 7 | KL/S | Kiloliters per Second |
| 8 | KL/M | Kiloliters per Minute |
| 9 | KL/H | Kiloliters per Hour |
| 10 | KG/S | Kilograms per Second |
| 11 | KG/M | Kilograms per Minute |
| 12 | KG/H | Kilograms per Hour |

### Time Format
- **Format:** `YYMMDDHHMMSS`
- **Example:** `260517153808` = May 17, 2026, 15:38:08

## Configuration

### Backend .env File
```bash
# MQTT Broker Configuration
MQTT_BROKER_HOST="your-mqtt-broker.com"  # e.g., "mqtt.eclipseprojects.io"
MQTT_BROKER_PORT="1883"                  # Standard MQTT port
MQTT_USERNAME="your_username"            # Optional
MQTT_PASSWORD="your_password"            # Optional
```

## API Endpoints

### Subscribe to Flowmeter
```bash
POST /api/flowmeter/subscribe/flowmeter
Content-Type: application/json

{
  "hardware_id": "4105",
  "location": "ETP Inlet",
  "description": "Main treatment plant flowmeter"
}
```

### Subscribe to Gateway
```bash
POST /api/flowmeter/subscribe/gateway
Content-Type: application/json

{
  "gateway_imei": "860560069008656",
  "name": "Main Gateway"
}
```

### Get Latest Reading
```bash
GET /api/flowmeter/latest/4105
```

**Response:**
```json
{
  "hardware_id": "4105",
  "imei": "862493051816688",
  "flow_rate_lpm": 125.5,
  "forward_totalizer": 1638440.0,
  "reverse_totalizer": 18.0,
  "unit_name": "L/M",
  "signal_strength": 28,
  "power_status": 1,
  "temperature": 25.5,
  "timestamp": "2026-05-17T15:38:08"
}
```

### Get All Latest Readings
```bash
GET /api/flowmeter/latest
```

### Get Historical Data
```bash
GET /api/flowmeter/history/4105?limit=100
```

### Check MQTT Status
```bash
GET /api/flowmeter/status
```

## Database Collections

### flowmeter_readings
Stores all historical flowmeter readings with full data.

### flowmeter_latest
Stores only the most recent reading for each flowmeter for quick access.

### gateway_status
Stores gateway status updates.

### gateway_latest  
Stores latest gateway status for each gateway.

## Usage Example

### 1. Configure MQTT Broker
Update `/app/backend/.env` with your MQTT broker details.

### 2. Subscribe to Devices
```bash
# Subscribe to a flowmeter
curl -X POST http://localhost:8001/api/flowmeter/subscribe/flowmeter \
  -H "Content-Type: application/json" \
  -d '{"hardware_id": "4105", "location": "ETP Inlet"}'

# Subscribe to gateway
curl -X POST http://localhost:8001/api/flowmeter/subscribe/gateway \
  -H "Content-Type: application/json" \
  -d '{"gateway_imei": "860560069008656"}'
```

### 3. Monitor Data
```bash
# Check MQTT connection status
curl http://localhost:8001/api/flowmeter/status

# Get latest readings
curl http://localhost:8001/api/flowmeter/latest

# Get specific flowmeter data
curl http://localhost:8001/api/flowmeter/latest/4105
```

## Frontend Integration

The frontend automatically fetches and displays real-time data from these API endpoints. Data updates every 3-5 seconds.

## Troubleshooting

### MQTT Not Connecting
1. Check MQTT broker host and port in .env
2. Verify network connectivity to broker
3. Check username/password if authentication is required
4. View backend logs: `tail -f /var/log/supervisor/backend.out.log`

### No Data Received
1. Verify subscription topics are correct
2. Check if IoT devices are publishing data
3. Monitor MQTT broker logs
4. Use MQTT client tool (e.g., MQTT Explorer) to verify data flow

### Data Not Updating in Frontend
1. Check API endpoints are responding
2. Verify MongoDB is running
3. Check browser console for errors
4. Ensure CORS is properly configured

## Security Notes

⚠️ **Production Deployment:**
- Use TLS/SSL for MQTT (port 8883)
- Enable MQTT broker authentication
- Implement API authentication/authorization
- Use environment variables for sensitive data
- Enable MongoDB authentication
- Set up firewall rules

## Support

For issues or questions:
- Backend logs: `/var/log/supervisor/backend.*.log`
- Frontend logs: `/var/log/supervisor/frontend.*.log`
- MongoDB logs: Check MongoDB service logs

Contact: envirolytics.official@gmail.com
