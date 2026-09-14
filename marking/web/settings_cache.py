
import datetime
import time
from typing import Any


from .models import SiteSettings

class SettingsCache(object):
    SET_HIDE_PROJECTS = 'site_hide_proj'
    SET_READ_ONLY = 'site_stu_ro'
    SET_SUPER_PROJECT_LOCK = 'site_sup_proj_lock'
    SET_SUPER_RESPONSE_LOCK = 'site_sup_resp_lock'

    '''This wrapps the SiteSettings model to cache requests and limit database queries.
    '''
    def __init__(self):
        self.entries = {} # Defer this until the first request
        self.__last_update_time = datetime.datetime(1980, 1, 1, 0, 0, 0, tzinfo=datetime.timezone.utc)
        self.__last_refresh = 0
        self.__refresh_time = 30

    def change_refresh_time(self, new_refresh):
        self.__refresh_time = new_refresh

    def __getitem__(self, __name: str) -> Any:
        # Check if we should update value
        gap = time.time() - self.__last_refresh

        if gap > self.__refresh_time:
            # Get all values that have changed since our last check
            updates = SiteSettings.get_values(self.__last_update_time)
            self.__last_update_time = datetime.datetime.now(datetime.timezone.utc)
            self.__last_refresh = time.time()
            self.entries.update(updates)

        if __name in self.entries:
            return self.entries[__name]
        raise KeyError(f'unknown attribute "{__name}"')
    
    def set(self, key, value):
        SiteSettings.set(key, value)
        self.entries[key] = value