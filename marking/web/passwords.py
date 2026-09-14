# This holds all the parts for implementing over-ride passwords and resets

import base64
import datetime
import json

from Crypto.Protocol.KDF import scrypt
from Crypto.Random import get_random_bytes

# Core functions from here on
def generate_password(password):
    N = 2**17
    R = 8
    P = 1
    
    salt = get_random_bytes(16)
    key = scrypt(password.encode('utf-8'), salt, 32, N=N, r=R, p=P)
    params = {'alg':'scrypt', 'n':N, 'r':R, 'p':P, 'salt':base64.urlsafe_b64encode(salt).decode('utf-8'), 'hash':base64.urlsafe_b64encode(key).decode('utf-8')}
    return json.dumps(params)

def check_password(data, password):
    data = json.loads(data)
    if 'hash' not in data:
        return False
    if 'salt' not in data:
        return False
    
    salt = base64.urlsafe_b64decode(data['salt'].encode('utf-8'))
    hash = base64.urlsafe_b64decode(data['hash'].encode('utf-8'))
    n = data['n']
    r = data['r']
    p = data['p']

    result = scrypt(password.encode('utf-8'), salt, 32, N=n, r=r, p=p)
    if len(result) != len(hash):
        return False
    valid = True
    for i in range(len(result)):
        valid = valid and (result[i]==hash[i])
    return valid

# As reset tokens are short-lived the values for scrypt are hardcoded
RESET_TOKEN_N = 2**17
RESET_TOKEN_R = 8
RESET_TOKEN_P = 1

def generate_password_reset():
    now = datetime.datetime.now(datetime.timezone.utc)
    now = now + datetime.timedelta(hours=12)
    now = int(now.timestamp())

    token_id = get_random_bytes(18) # 144 bits
    token_id_s = base64.urlsafe_b64encode(token_id).decode('utf-8')

    token = get_random_bytes(32) # 256 bits
    token_s = base64.urlsafe_b64encode(token).decode('utf-8')

    token_hash = scrypt(token, token_id, 32, N=RESET_TOKEN_N, r=RESET_TOKEN_R, p=RESET_TOKEN_P)
    token_hash_s = base64.urlsafe_b64encode(token_hash).decode('utf-8')

    reset_data = {'expire':now, 'id':token_id_s, 'hash':token_hash_s}
    return token_id_s, token_s, json.dumps(reset_data)

def validate_password_reset(data, token_s):
    data = json.loads(data)

    if 'expire' not in data:
        return False
    
    now = datetime.datetime.now(datetime.timezone.utc).timestamp()
    if now > data['expire']:
        return False
    
    # Recompute and check the hash
    token_id = base64.urlsafe_b64decode(data['id'])
    token_hash = base64.urlsafe_b64decode(data['hash'])
    token = base64.urlsafe_b64decode(token_s)

    result = scrypt(token, token_id, 32, N=RESET_TOKEN_N, r=RESET_TOKEN_R, p=RESET_TOKEN_P)
    if len(result) != len(token_hash):
        return False
    valid = True
    for i in range(len(result)):
        valid = valid and (result[i]==token_hash[i])
    
    return valid