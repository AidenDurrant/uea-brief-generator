#OLD:.\venv\scripts\activate.ps1
${env:PATH}="libs;${env:PATH}"
${env:WEBSITE_DEBUG}='true'
${env:WEBSITE_DISABLE_AD}='true'
${env:WEBSITE_API_SECRET}='secret_api_token'
${env:WEBSITE_URL}='http://127.0.0.1:8000'
${env:WEBSITE_DEBUG_LOG}='debug.log'
${env:WEBSITE_TEMP}='C:\Temp\marking-temp'