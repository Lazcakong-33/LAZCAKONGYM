# INFORME DE RIESGOS Y PENDIENTES – LAZCAKONG GYM 5.0

## 1. CLASIFICACIÓN DE RIESGOS

### **Riesgo 1: Caché de WebAPK en Dispositivos Android Antiguos (MEDIO)**
* **Descripción**: Los usuarios que ya instalaron la PWA en su dispositivo Android antes de la unificación de iconos V5 pueden seguir viendo el splash nativo antiguo hasta que Android actualice el WebAPK en segundo plano.
* **Mitigación**: Instrucciones claras para desinstalar el acceso directo y volver a agregarlo desde Chrome sin pérdida de datos.

### **Riesgo 2: Concurrencia de Red en Firestore (BAJO)**
* **Descripción**: Posibles conflictos de sincronización offline/online en dispositivos móviles con pérdida intermitente de conectividad en el gimnasio.
* **Mitigación**: El sistema cuenta con colas de sincronización offline y persistencia local robusta en `IndexedDB` y `localStorage`.

---

## 2. PENDIENTES TÉCNICOS ANTES DE PRODUCCIÓN
1. Ejecución de pruebas en dispositivo físico real con Android para validar la transición del splash WebAPK V5.
2. Monitoreo de tokens de Firebase Auth tras el primer despliegue en producción.
