from pathlib import Path
from pymongo import MongoClient
import json

def env(path):
    out={}
    for line in Path(path).read_text().splitlines():
        line=line.strip()
        if line and not line.startswith('#') and '=' in line:
            k,v=line.split('=',1); out[k]=v.strip().strip('"').strip("'")
    return out
benv=env('/app/backend/.env')
db=MongoClient(benv['MONGO_URL'])[benv['DB_NAME']]
print(json.dumps({
  'users': list(db.users.find({}, {'_id':0,'email':1,'id':1,'role':1,'is_active':1})),
  'registry_count': db.instrument_registry.count_documents({}),
  'readings_counts': {c: db[c].count_documents({}) for c in ['instrument_readings','instrument_latest','flowmeter_readings','flowmeter_latest']},
  'bugverify_leftovers': {c: db[c].count_documents({'hardware_id': {'$regex': '^BUGVERIFY'}}) for c in ['instrument_registry','instrument_readings','instrument_latest','flowmeter_readings','flowmeter_latest','flowmeter_categories']}
}, indent=2, default=str))
