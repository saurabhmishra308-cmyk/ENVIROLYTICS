# Auth Testing Playbook Used in Bug Verification

- Verify `/app/memory/test_credentials.md` credentials before auth tests.
- POST `/api/auth/login` for admin and client; require HTTP 200, `access_token`, and expected `user.role`.
- Use the returned bearer token for `/api/auth/me` and role-protected endpoints.
- Confirm users still exist in MongoDB/users list after device reassignment or cleanup.