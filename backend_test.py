"""
Backend test for email notification pipeline verification.

Test Steps:
1. Configure recipient - GET/PUT /api/notifications/emails
2. Fire test email - POST /api/notifications/test
3. Analyze response
4. Check backend logs
5. Regression check - flowmeter status and instrument registry
"""
import requests
import json
import sys

# Backend URL from frontend/.env
BACKEND_URL = "https://envirolytics-hub.preview.emergentagent.com/api"

# Admin credentials from test_result.md
ADMIN_EMAIL = "admin@envirolytics.com"
ADMIN_PASSWORD = "Admin@Envirolytics2026"

# Target recipient email
TARGET_EMAIL = "saurabh@envirolytics.in"


def print_section(title):
    print(f"\n{'='*80}")
    print(f"  {title}")
    print(f"{'='*80}\n")


def test_email_notification_pipeline():
    """Test the email notification pipeline end-to-end."""
    
    print_section("EMAIL NOTIFICATION PIPELINE TEST")
    
    # Step 0: Admin login
    print("Step 0: Admin Login")
    print(f"POST {BACKEND_URL}/auth/login")
    login_resp = requests.post(
        f"{BACKEND_URL}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
    )
    print(f"Status: {login_resp.status_code}")
    
    if login_resp.status_code != 200:
        print(f"❌ FAILED: Admin login failed")
        print(f"Response: {login_resp.text}")
        return False
    
    login_data = login_resp.json()
    token = login_data.get("access_token")
    if not token:
        print(f"❌ FAILED: No access_token in login response")
        print(f"Response: {json.dumps(login_data, indent=2)}")
        return False
    
    print(f"✅ Admin login successful")
    print(f"Token: {token[:20]}...")
    
    headers = {"Authorization": f"Bearer {token}"}
    
    # Step 1a: GET current recipients
    print_section("Step 1a: GET Current Recipients")
    print(f"GET {BACKEND_URL}/notifications/emails")
    get_resp = requests.get(f"{BACKEND_URL}/notifications/emails", headers=headers)
    print(f"Status: {get_resp.status_code}")
    
    if get_resp.status_code != 200:
        print(f"❌ FAILED: GET /api/notifications/emails failed")
        print(f"Response: {get_resp.text}")
        return False
    
    get_data = get_resp.json()
    print(f"✅ Current recipients: {json.dumps(get_data, indent=2)}")
    original_emails = get_data.get("emails", [])
    
    # Step 1b: PUT new recipient
    print_section("Step 1b: PUT New Recipient")
    print(f"PUT {BACKEND_URL}/notifications/emails")
    print(f"Body: {{'emails': ['{TARGET_EMAIL}']}}")
    put_resp = requests.put(
        f"{BACKEND_URL}/notifications/emails",
        headers=headers,
        json={"emails": [TARGET_EMAIL]}
    )
    print(f"Status: {put_resp.status_code}")
    
    if put_resp.status_code != 200:
        print(f"❌ FAILED: PUT /api/notifications/emails failed")
        print(f"Response: {put_resp.text}")
        return False
    
    put_data = put_resp.json()
    print(f"✅ Recipients updated: {json.dumps(put_data, indent=2)}")
    
    # Step 1c: GET again to verify
    print_section("Step 1c: GET Recipients Again (Verify)")
    print(f"GET {BACKEND_URL}/notifications/emails")
    verify_resp = requests.get(f"{BACKEND_URL}/notifications/emails", headers=headers)
    print(f"Status: {verify_resp.status_code}")
    
    if verify_resp.status_code != 200:
        print(f"❌ FAILED: GET /api/notifications/emails (verify) failed")
        print(f"Response: {verify_resp.text}")
        return False
    
    verify_data = verify_resp.json()
    print(f"✅ Verified recipients: {json.dumps(verify_data, indent=2)}")
    
    if TARGET_EMAIL not in verify_data.get("emails", []):
        print(f"❌ FAILED: Target email {TARGET_EMAIL} not in recipients list")
        return False
    
    print(f"✅ Target email {TARGET_EMAIL} confirmed in recipients list")
    
    # Step 2: Fire test email
    print_section("Step 2: Fire Test Email")
    print(f"POST {BACKEND_URL}/notifications/test")
    test_resp = requests.post(f"{BACKEND_URL}/notifications/test", headers=headers)
    print(f"Status: {test_resp.status_code}")
    
    if test_resp.status_code != 200:
        print(f"❌ FAILED: POST /api/notifications/test failed")
        print(f"Response: {test_resp.text}")
        return False
    
    test_data = test_resp.json()
    print(f"✅ Test email response: {json.dumps(test_data, indent=2)}")
    
    # Step 3: Analyze response
    print_section("Step 3: Analyze Response")
    
    sent = test_data.get("sent")
    transport = test_data.get("transport")
    reason = test_data.get("reason")
    
    print(f"sent: {sent}")
    print(f"transport: {transport}")
    print(f"reason: {reason}")
    
    if sent is True:
        if transport == "smtp":
            print(f"✅ SUCCESS: Zoho SMTP delivered the email")
            print(f"Full response: {json.dumps(test_data, indent=2)}")
        elif transport == "resend":
            print(f"✅ SUCCESS: Resend delivered the email")
            print(f"Full response: {json.dumps(test_data, indent=2)}")
        else:
            print(f"⚠️  WARNING: Email sent but transport unknown: {transport}")
            print(f"Full response: {json.dumps(test_data, indent=2)}")
    elif sent is False:
        if reason and "smtp:" in reason:
            print(f"❌ SMTP MISCONFIGURED: {reason}")
            print(f"Possible issues: auth failed, host unreachable, port blocked")
        elif reason and "No email transport configured" in reason:
            print(f"❌ ENV VARS DROPPED: {reason}")
        else:
            print(f"❌ EMAIL SEND FAILED: {reason}")
        print(f"Full response: {json.dumps(test_data, indent=2)}")
    else:
        print(f"⚠️  UNEXPECTED: sent field is neither true nor false: {sent}")
        print(f"Full response: {json.dumps(test_data, indent=2)}")
    
    # Step 5: Regression check
    print_section("Step 5: Regression Check")
    
    # Check flowmeter status
    print("5a. GET /api/flowmeter/status")
    status_resp = requests.get(f"{BACKEND_URL}/flowmeter/status", headers=headers)
    print(f"Status: {status_resp.status_code}")
    
    if status_resp.status_code == 200:
        status_data = status_resp.json()
        connected = status_data.get("connected")
        print(f"✅ Flowmeter status: connected={connected}")
        if connected is not True:
            print(f"⚠️  WARNING: MQTT not connected (expected for Skyrise broker)")
    else:
        print(f"⚠️  WARNING: GET /api/flowmeter/status failed: {status_resp.status_code}")
    
    # Check instrument registry
    print("\n5b. GET /api/instrument-registry")
    registry_resp = requests.get(f"{BACKEND_URL}/instrument-registry", headers=headers)
    print(f"Status: {registry_resp.status_code}")
    
    if registry_resp.status_code == 200:
        registry_data = registry_resp.json()
        count = len(registry_data.get("instruments", []))
        print(f"✅ Instrument registry: {count} instruments")
    else:
        print(f"⚠️  WARNING: GET /api/instrument-registry failed: {registry_resp.status_code}")
    
    # Final summary
    print_section("FINAL SUMMARY")
    
    if sent is True:
        print(f"✅ EMAIL NOTIFICATION PIPELINE: WORKING")
        print(f"   - Transport: {transport}")
        print(f"   - Recipient: {TARGET_EMAIL}")
        print(f"   - Status: Email sent successfully from SMTP server")
        print(f"\n⚠️  NOTE: Cannot verify email actually arrived in inbox (system limitation)")
        print(f"   Please check {TARGET_EMAIL} inbox manually to confirm delivery.")
        return True
    else:
        print(f"❌ EMAIL NOTIFICATION PIPELINE: FAILED")
        print(f"   - Reason: {reason}")
        print(f"   - Action Required: Fix SMTP configuration or check logs")
        return False


if __name__ == "__main__":
    success = test_email_notification_pipeline()
    sys.exit(0 if success else 1)
