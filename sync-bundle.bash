#!/bin/bash
# Copy the built frontend export into Django.
#
# Wraps `manage.py sync_brief_bundle` so it can be run from a fresh terminal:
# this usually runs from frontend/ via `npm run build:install`, which is rarely
# the same shell that sourced dev-setup.bash, and every Django command needs
# those variables. An environment that is already configured is left alone.
set -e
cd "$(dirname "$0")"

if [ -z "$WEBSITE_TEMP" ]; then
    echo "Marking-site environment not set; sourcing dev-setup.bash."
    . ./dev-setup.bash
fi

python marking/manage.py sync_brief_bundle
