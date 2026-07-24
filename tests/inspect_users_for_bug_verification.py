import os, json
from pathlib import Path
from pymongo import MongoClient

def read_env(path):
    out = {}
    for line in Path(path).read_text().splitlines():
        line=line.strip()
        if not line or line.startswith('#') or '=' not in line: continue
        k,v=line.split('=',1); out[k]=v.strip().strip('"').strip("'")
    return out
benv=read_env('/app/backend/.env')
db=MongoClient(benv['MONGO_URL'])[benv['DB_NAME']]
users=list(db.users.find({}, {'_id':0,'id':1,'email':1,'role':1,'is_active':1,'permissions':1,'created_at':1,'service_expiry_date':1,'password_hash':1}))
for u in users:
    ph=u.get('password_hash','')
    u['password_hash_prefix']=ph[:12]
    u['password_hash_len']=len(ph)
    u.pop('password_hash', None)
print(json.dumps({'count':len(users),'users':users}, indent=2, default=str))
print('registry_count', db.instrument_registry.count_documents({}))
print('collections', {c: db[c].count_documents({}) for c in ['instrument_readings','instrument_latest','flowmeter_readings','flowmeter_latest']})
