# IoT Device Configuration Guide
## Envirolytics Monitoring System Integration

---

## 🔧 DEVICE CONFIGURATION REQUIREMENTS

### 1. MQTT BROKER DETAILS

Provide these details to your IoT device/gateway:

```
MQTT Broker Host: your-mqtt-broker.envirolytics.in
MQTT Broker Port: 1883 (Standard) or 8883 (TLS/SSL)
Protocol: MQTT v3.1.1 or v5.0
QoS Level: 1 (At least once delivery)
Keep Alive: 60 seconds
Clean Session: True
```

**For Production Deployment:**
```
MQTT Broker: mqtt.envirolytics.in
Port: 8883 (TLS Encrypted)
Username: [Will be provided by admin]
Password: [Will be provided by admin]
Certificate: [CA certificate for TLS]
```

---

## 📡 TOPIC STRUCTURE

### Gateway Status Topic
```
Topic: {GATEWAY_IMEI}/0
Message Format: Plain text
Example: 860560069008656/0
Payload: 0,ON
```

### Flowmeter Data Topic
```
Topic: {HARDWARE_ID}/0
Message Format: JSON
Example: 4105/0
```

---

## 📋 DATA PACKET FORMAT (JSON)

### Required Fields
```json
{
  "IMEI": "862493051816688",        // Device IMEI (15 digits)
  "IMSI": "404980518652835",        // SIM card IMSI (15 digits)
  "SIGNAL": "28",                   // GSM signal strength (0-31)
  "TIME": "260517153808",           // Timestamp: YYMMDDHHMMSS
  "FLOW": "125.50",                 // Flow rate in L/H (Liters per Hour)
  "TOT1": "39959.00",               // Totalizer part 1 (0-65535)
  "TOT2": "25.00",                  // Totalizer part 2 (multiplier)
  "RTOT1": "18.00",                 // Reverse totalizer part 1
  "RTOT2": "0.00",                  // Reverse totalizer part 2
  "UNT": "2",                       // Unit code (see unit table)
  "POW": "1",                       // Power status (0=OFF, 1=ON)
  "TEMPER": "24.5",                 // Temperature in Celsius
  "VER": "14"                       // Firmware version
}
```

### Unit Codes Reference
```
Code  Unit    Description
----  ----    -----------
1     L/S     Liters per Second
2     L/M     Liters per Minute
3     L/H     Liters per Hour (Default)
4     M3/S    Cubic Meters per Second
5     M3/M    Cubic Meters per Minute
6     M3/H    Cubic Meters per Hour
7     KL/S    Kiloliters per Second
8     KL/M    Kiloliters per Minute
9     KL/H    Kiloliters per Hour
10    KG/S    Kilograms per Second
11    KG/M    Kilograms per Minute
12    KG/H    Kilograms per Hour
```

---

## 🔢 CALCULATIONS PERFORMED BY SERVER

**Forward Totalizer:**
```
Total = (TOT2 × 65535) + TOT1
Example: (25 × 65535) + 39959 = 1,677,334 liters
```

**Reverse Totalizer:**
```
Total = (RTOT2 × 65535) + RTOT1
Example: (0 × 65535) + 18 = 18 liters
```

**Flow Rate Conversion:**
```
L/min = L/H ÷ 60
Example: 125.50 L/H = 2.09 L/min
```

---

## 🆔 DEVICE REGISTRATION

### Step 1: Register Gateway
```bash
POST https://your-app.envirolytics.in/api/flowmeter/subscribe/gateway
Content-Type: application/json
Authorization: Bearer [ADMIN_TOKEN]

{
  "gateway_imei": "860560069008656",
  "name": "Gateway-Site-A"
}
```

### Step 2: Register Flowmeter
```bash
POST https://your-app.envirolytics.in/api/flowmeter/subscribe/flowmeter
Content-Type: application/json
Authorization: Bearer [ADMIN_TOKEN]

{
  "hardware_id": "4105",
  "location": "ETP Inlet",
  "description": "Main treatment plant flowmeter"
}
```

---

## ⚙️ DEVICE SETTINGS CHECKLIST

### Network Configuration
- [ ] APN configured for SIM card
- [ ] GPRS/4G connectivity enabled
- [ ] Static IP or DDNS configured (if required)
- [ ] Firewall allows outbound port 1883/8883

### MQTT Settings
- [ ] MQTT broker URL configured
- [ ] MQTT port configured (1883 or 8883)
- [ ] Username/Password set (if required)
- [ ] TLS certificate installed (for 8883)
- [ ] QoS level set to 1
- [ ] Publish interval: 30-60 seconds recommended

### Data Settings
- [ ] Hardware ID programmed correctly
- [ ] IMEI recorded and registered
- [ ] Unit code configured (default: 2 for L/M)
- [ ] Totalizer reset (if needed)
- [ ] Timestamp synchronized with NTP

---

## 📝 SAMPLE CONFIGURATIONS

### Configuration 1: Basic Flowmeter
```
Device Type: Electromagnetic Flowmeter
Hardware ID: FM-001
Location: ETP Inlet
MQTT Topic: FM-001/0
Publish Interval: 30 seconds
Unit: L/M (Code: 2)
```

### Configuration 2: DWLR (Water Level)
```
Device Type: Digital Water Level Recorder
Hardware ID: DWLR-BW-01
Location: Borewell A
MQTT Topic: DWLR-BW-01/0
Publish Interval: 60 seconds
Unit: Meters
```

---

## 🧪 TESTING PROCEDURE

### 1. Test MQTT Connection
```bash
# Use MQTT client tool (e.g., MQTT Explorer, mosquitto_pub)
mosquitto_pub -h mqtt.envirolytics.in \
  -p 1883 \
  -t "TEST-DEVICE/0" \
  -m '{"IMEI":"123456789012345","FLOW":"100.00","TIME":"260601120000"}'
```

### 2. Verify Data Reception
```bash
# Check if data is received
curl https://your-app.envirolytics.in/api/flowmeter/latest/TEST-DEVICE
```

### 3. Monitor Logs
- Backend logs: Check for message processing
- Database: Verify data insertion
- Frontend: Confirm real-time display

---

## 📊 DATA PUBLISHING SCHEDULE

**Recommended Publishing Intervals:**

| Parameter Type | Interval | Reason |
|----------------|----------|--------|
| Flow Rate | 30 sec | Real-time monitoring |
| Water Level | 60 sec | Slow-changing parameter |
| Water Quality | 5 min | Moderate changes |
| Temperature | 5 min | Slow-changing |
| Totalizer | 1 min | Cumulative tracking |
| Gateway Status | 5 min | Health check |

---

## 🔐 SECURITY CONSIDERATIONS

### Device Security
1. **Change default passwords** on all devices
2. **Enable TLS/SSL** for MQTT (port 8883)
3. **Use unique credentials** for each device
4. **Implement certificate pinning** if possible
5. **Keep firmware updated** regularly

### Network Security
1. **Use VPN** for device communication (recommended)
2. **Whitelist IP addresses** on firewall
3. **Enable intrusion detection** on network
4. **Monitor unusual traffic patterns**
5. **Implement rate limiting** on MQTT broker

---

## 🚨 TROUBLESHOOTING

### Device Not Connecting
```
1. Check SIM card data balance
2. Verify APN settings
3. Test network connectivity
4. Check MQTT broker URL/port
5. Verify firewall rules
6. Check device logs for errors
```

### Data Not Appearing
```
1. Verify device is registered in system
2. Check topic format matches: {HARDWARE_ID}/0
3. Validate JSON format
4. Check timestamp format (YYMMDDHHMMSS)
5. Verify required fields are present
6. Check server logs for errors
```

### Connection Drops
```
1. Check network signal strength (SIGNAL field)
2. Increase Keep-Alive timeout
3. Enable auto-reconnect on device
4. Check power supply stability
5. Monitor SIM card validity
```

---

## 📞 SUPPORT INFORMATION

**For Device Configuration Support:**
- Email: envirolytics.official@gmail.com
- Phone: +91 83180 62553
- Technical Support: Available 24x7

**Required Information When Contacting Support:**
1. Device Hardware ID
2. IMEI number
3. Location/Site name
4. Error messages/logs
5. Network signal strength
6. Last successful data transmission time

---

## 📄 DEVICE ONBOARDING FORM

**Fill this form for each new device:**

```
Device Information:
- Device Type: ________________
- Hardware ID: ________________
- Serial Number: ________________
- IMEI: ________________
- IMSI: ________________

Installation Details:
- Site Name: ________________
- Location: ________________
- Installation Date: ________________
- Installed By: ________________

Network Configuration:
- SIM Provider: ________________
- APN: ________________
- MQTT Broker: ________________
- Topic: ________________

Contact Information:
- Site Manager: ________________
- Phone: ________________
- Email: ________________
```

---

## ✅ PRE-DEPLOYMENT CHECKLIST

- [ ] Device hardware tested and calibrated
- [ ] SIM card activated with data plan
- [ ] MQTT credentials obtained from admin
- [ ] Device registered in system
- [ ] Test data transmission successful
- [ ] Installation certificate generated
- [ ] Calibration certificate issued
- [ ] Site personnel trained
- [ ] Documentation handed over
- [ ] Remote monitoring verified

---

**Document Version:** 1.0  
**Last Updated:** June 2026  
**Prepared By:** Envirolytics Technical Team

---

## 🔗 QUICK REFERENCE

**MQTT Publish Command (for testing):**
```bash
mosquitto_pub -h localhost -p 1883 -t "4105/0" -m '{"IMEI":"862493051816688","IMSI":"404980518652835","SIGNAL":"28","TIME":"260601153000","FLOW":"125.50","TOT1":"39959.00","TOT2":"25.00","RTOT1":"18.00","RTOT2":"0.00","UNT":"2","POW":"1","TEMPER":"24.5","VER":"14"}'
```

**Check Device Status:**
```bash
curl https://your-app.envirolytics.in/api/flowmeter/latest/4105
```

**View All Active Devices:**
```bash
curl https://your-app.envirolytics.in/api/flowmeter/latest
```
