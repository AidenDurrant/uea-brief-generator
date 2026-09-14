from django.contrib import admin

from .models import (
    Assessment,
    BriefRole,
    ClusterLeadScope,
    ReviewAssignment,
    ReviewEvent,
)

admin.site.register(Assessment)
admin.site.register(BriefRole)
admin.site.register(ClusterLeadScope)
admin.site.register(ReviewAssignment)
admin.site.register(ReviewEvent)
