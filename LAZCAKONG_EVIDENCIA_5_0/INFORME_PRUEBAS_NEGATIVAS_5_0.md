# INFORME DE PRUEBAS NEGATIVAS DE SEGURIDAD – LAZCAKONG GYM 5.0

**Fecha de Auditoría:** 2026-11-13T19:24:01.079Z
**Objetivo:** Verificación estricta de rechazo ante vectores de ataque (Privilege Escalation, Identity Spoofing, Shadow Fields, Fake Tombstones, Cross-Profile).

| ID | Vector de Ataque | Colección Objetivo | Resultado Esperado | Resultado Real | Estado |
|:---|:---|:---|:---|:---|:---|
| NEG-01 | Privilege Escalation (isAdmin = true) | /users/user_attacker_123 | PERMISSION_DENIED | PERMISSION_DENIED | **PASSED_NEGATIVE** |
  *Descripción:* El atacante intenta crear o actualizar su perfil de usuario asignándose isAdmin: true. Regla bloquea (isAdmin != true / incoming().isAdmin == existing().isAdmin).

| NEG-02 | Identity Impersonation (Changing uid field) | /users/user_victim_456 | PERMISSION_DENIED | PERMISSION_DENIED | **PASSED_NEGATIVE** |
  *Descripción:* El atacante intenta modificar el campo uid o escribir en un documento ajeno. Regla bloquea (request.auth.uid == uid && incoming().uid == existing().uid).

| NEG-03 | Shadow Field Injection / Unauthorized Keys | /users/user_attacker_123 | PERMISSION_DENIED | PERMISSION_DENIED | **PASSED_NEGATIVE** |
  *Descripción:* El atacante intenta inyectar campos no permitidos en una actualización. Regla bloquea (affectedKeys().hasOnly([...]) rechaza claves no whitelisted).

| NEG-04 | Fake Tombstone Creation | /deleted_athletes/victim_athlete_id | PERMISSION_DENIED | PERMISSION_DENIED | **PASSED_NEGATIVE** |
  *Descripción:* El atacante intenta crear un registro de eliminación (tombstone) para un perfil ajeno. Regla bloquea (request.auth.uid == athleteId && request.resource.data.authUid == request.auth.uid).

| NEG-05 | Cross-Profile Data Modification | /athletes/victim_athlete_id | PERMISSION_DENIED | PERMISSION_DENIED | **PASSED_NEGATIVE** |
  *Descripción:* El atacante intenta modificar un documento de atleta que no le pertenece. Regla bloquea (isOwner / isAdmin falso).

## DICTAMEN DE SEGURIDAD POST-PRUEBAS NEGATIVAS

Todas las pruebas negativas arrojaron **PERMISSION_DENIED** de forma determinista. Las reglas `firestore.rules` y `contingency_firestore.rules` bloquean categóricamente cualquier intento de escalada de privilegios, manipulación de identidad, inyección de campos no autorizados o creación falsa de tombstones.
