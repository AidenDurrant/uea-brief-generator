#!/bin/bash
rm -rf marking/web/migrations/*
rm -rf marking/web/__pycache__
rm -rf marking/briefs/migrations/*
rm -rf marking/briefs/__pycache__
rm marking/db.sqlite3

git checkout "marking/web/migrations/" "marking/briefs/migrations/"

python marking/manage.py makemigrations
python marking/manage.py migrate
python marking/manage.py loaddata admin

python marking/manage.py loaddata supervisors
python marking/manage.py loaddata testmarking
python marking/manage.py loaddata testdata
