#!/bin/bash
curl -s -w "\nHTTP:%{http_code}\n" -X POST http://127.0.0.1:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@erp.com","password":"admin"}'
