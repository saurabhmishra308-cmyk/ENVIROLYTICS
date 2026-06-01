# IoT Device Quick Setup Card
## Envirolytics Monitoring System

---

## 📱 STEP-BY-STEP INSTALLATION

### Step 1: Physical Installation
1. Mount device at designated location
2. Connect power supply (12V DC / 230V AC)
3. Connect sensors/probes
4. Verify LED indicators

### Step 2: SIM Card Configuration
1. Insert activated SIM card
2. Configure APN settings:
   - APN: `[provided by network]`
   - Username: `[if required]`
   - Password: `[if required]`

### Step 3: MQTT Settings
```
Broker: mqtt.envirolytics.in
Port: 1883
Username: [get from admin]
Password: [get from admin]
Topic: [DEVICE_ID]/0
```

### Step 4: Device Parameters
```
Hardware ID: _____________
IMEI: _____________
Publish Interval: 30 sec
Unit Code: 2 (L/M)
```

### Step 5: Registration
Contact admin to register device:
- Hardware ID
- Location
- IMEI number

### Step 6: Test & Verify
1. Check network signal (>15)
2. Verify data on portal
3. Generate certificates

---

## 📊 DATA PACKET EXAMPLE

```json
{
  "IMEI": "862493051816688",
  "TIME": "260601153000",
  "FLOW": "125.50",
  "TOT1": "39959.00",
  "TOT2": "25.00",
  "UNT": "2",
  "POW": "1",
  "TEMPER": "24.5"
}
```

---

## 🔧 COMMON UNIT CODES

| Code | Unit | Usage |
|------|------|-------|
| 2 | L/M | Most common |
| 3 | L/H | Hourly rate |
| 6 | M3/H | Large volumes |

---

## ⚠️ TROUBLESHOOTING

**No Data?**
- Check SIM balance
- Verify network signal
- Check power supply
- Restart device

**Wrong Readings?**
- Calibrate sensor
- Check unit code
- Verify mounting

---

## 📞 SUPPORT

**Email:** envirolytics.official@gmail.com  
**Phone:** +91 83180 62553  
**Portal:** https://your-app.envirolytics.in

---

## ✅ INSTALLATION CHECKLIST

- [ ] Device mounted securely
- [ ] Power connected
- [ ] SIM inserted & active
- [ ] Network signal good (>15)
- [ ] MQTT configured
- [ ] Device registered
- [ ] Data visible on portal
- [ ] Certificates generated
- [ ] Client trained
- [ ] Documentation given

---

**Installation Date:** ___________  
**Installer Name:** ___________  
**Signature:** ___________
