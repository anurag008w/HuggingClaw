from backend.models.permissions import PermissionLevel

class SecurityManager:
    def requires_confirmation(self, permission: PermissionLevel) -> bool:
        return permission == PermissionLevel.DANGEROUS
