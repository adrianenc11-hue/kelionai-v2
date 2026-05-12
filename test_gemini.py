import os
import requests
import json

api_key = os.environ.get('GOOGLE_API_KEY')
if not api_key:
    from dotenv import load_dotenv
    load_dotenv('.env.local')
    api_key = os.environ.get('GOOGLE_API_KEY')

if not api_key:
    print("NO API KEY")
    exit(1)

url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
payload = {
    "model": "gemini-2.5-flash",
    "messages": [{"role": "user", "content": "Hello"}]
}

resp = requests.post(url, headers=headers, json=payload)
print(resp.status_code)
print(resp.text)
