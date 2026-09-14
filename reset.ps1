Remove-Item -Recurse -Force marking\web\migrations\*
Remove-Item -Recurse -Force marking\web\__pycache__
Remove-Item -Recurse -Force marking\briefs\migrations\*
Remove-Item -Recurse -Force marking\briefs\__pycache__
Remove-Item marking\db.sqlite3
git checkout "marking/web/migrations/*" "marking/briefs/migrations/*"
python marking/manage.py makemigrations
python marking/manage.py migrate
python marking/manage.py loaddata admin

python marking/manage.py loaddata supervisors
# Override rjal,jc,jm accounts to have a password of 'password' and add a student1 account.
python marking/manage.py loaddata testdata

python marking/manage.py loaddata testmarking
