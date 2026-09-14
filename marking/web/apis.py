import functools
import json
import re

from django.conf import settings
from django.http import HttpResponseBadRequest, HttpResponseNotFound, HttpResponseForbidden, FileResponse, JsonResponse, HttpResponseServerError
from django.shortcuts import redirect, render, HttpResponse
from django.views.decorators.csrf import csrf_exempt

from .auth import login
from .middleware import InjectContext
