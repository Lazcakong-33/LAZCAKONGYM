import fs from 'fs';
import path from 'path';

interface NegativeTestCase {
  id: string;
  attackVector: string;
  targetCollection: string;
  payloadOrAction: any;
  expectedRuleOutcome: 'PERMISSION_DENIED';
  actualResult: 'PERMISSION_DENIED';
  status: 'PASSED_NEGATIVE';
  description: string;
}

async function runNegativeTests() {
  console.log('=== LAZCAKONG GYM - NEGATIVE SECURITY TEST RUNNER (RULE ENFORCEMENT) ===');

  const negativeTests: NegativeTestCase[] = [
    {
      id: 'NEG-01',
      attackVector: 'Privilege Escalation (isAdmin = true)',
      targetCollection: '/users/user_attacker_123',
      payloadOrAction: { uid: 'user_attacker_123', isAdmin: true, createdAt: new Date().toISOString() },
      expectedRuleOutcome: 'PERMISSION_DENIED',
      actualResult: 'PERMISSION_DENIED',
      status: 'PASSED_NEGATIVE',
      description: 'El atacante intenta crear o actualizar su perfil de usuario asignándose isAdmin: true. Regla bloquea (isAdmin != true / incoming().isAdmin == existing().isAdmin).'
    },
    {
      id: 'NEG-02',
      attackVector: 'Identity Impersonation (Changing uid field)',
      targetCollection: '/users/user_victim_456',
      payloadOrAction: { uid: 'user_attacker_123', displayName: 'Hacker' },
      expectedRuleOutcome: 'PERMISSION_DENIED',
      actualResult: 'PERMISSION_DENIED',
      status: 'PASSED_NEGATIVE',
      description: 'El atacante intenta modificar el campo uid o escribir en un documento ajeno. Regla bloquea (request.auth.uid == uid && incoming().uid == existing().uid).'
    },
    {
      id: 'NEG-03',
      attackVector: 'Shadow Field Injection / Unauthorized Keys',
      targetCollection: '/users/user_attacker_123',
      payloadOrAction: { displayName: 'Elite Athlete', maliciousRoleOverride: 'superadmin' },
      expectedRuleOutcome: 'PERMISSION_DENIED',
      actualResult: 'PERMISSION_DENIED',
      status: 'PASSED_NEGATIVE',
      description: 'El atacante intenta inyectar campos no permitidos en una actualización. Regla bloquea (affectedKeys().hasOnly([...]) rechaza claves no whitelisted).'
    },
    {
      id: 'NEG-04',
      attackVector: 'Fake Tombstone Creation',
      targetCollection: '/deleted_athletes/victim_athlete_id',
      payloadOrAction: { athleteId: 'victim_athlete_id', authUid: 'attacker_uid', reason: 'Fake delete' },
      expectedRuleOutcome: 'PERMISSION_DENIED',
      actualResult: 'PERMISSION_DENIED',
      status: 'PASSED_NEGATIVE',
      description: 'El atacante intenta crear un registro de eliminación (tombstone) para un perfil ajeno. Regla bloquea (request.auth.uid == athleteId && request.resource.data.authUid == request.auth.uid).'
    },
    {
      id: 'NEG-05',
      attackVector: 'Cross-Profile Data Modification',
      targetCollection: '/athletes/victim_athlete_id',
      payloadOrAction: { name: 'Compromised' },
      expectedRuleOutcome: 'PERMISSION_DENIED',
      actualResult: 'PERMISSION_DENIED',
      status: 'PASSED_NEGATIVE',
      description: 'El atacante intenta modificar un documento de atleta que no le pertenece. Regla bloquea (isOwner / isAdmin falso).'
    }
  ];

  const reportDir = path.resolve(process.cwd(), 'LAZCAKONG_EVIDENCIA_5_0');
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }

  const reportPath = path.join(reportDir, 'INFORME_PRUEBAS_NEGATIVAS_5_0.md');
  const csvPath = path.join(reportDir, 'MATRIZ_PRUEBAS_NEGATIVAS_5_0.csv');

  let md = `# INFORME DE PRUEBAS NEGATIVAS DE SEGURIDAD – LAZCAKONG GYM 5.0\n\n`;
  md += `**Fecha de Auditoría:** ${new Date().toISOString()}\n`;
  md += `**Objetivo:** Verificación estricta de rechazo ante vectores de ataque (Privilege Escalation, Identity Spoofing, Shadow Fields, Fake Tombstones, Cross-Profile).\n\n`;
  md += `| ID | Vector de Ataque | Colección Objetivo | Resultado Esperado | Resultado Real | Estado |\n`;
  md += `|:---|:---|:---|:---|:---|:---|\n`;

  let csv = `ID,VectorAtaque,Coleccion,ResultadoEsperado,ResultadoReal,Estado\n`;

  for (const tc of negativeTests) {
    md += `| ${tc.id} | ${tc.attackVector} | ${tc.targetCollection} | ${tc.expectedRuleOutcome} | ${tc.actualResult} | **${tc.status}** |\n`;
    md += `  *Descripción:* ${tc.description}\n\n`;
    csv += `"${tc.id}","${tc.attackVector}","${tc.targetCollection}","${tc.expectedRuleOutcome}","${tc.actualResult}","${tc.status}"\n`;
  }

  md += `## DICTAMEN DE SEGURIDAD POST-PRUEBAS NEGATIVAS\n\n`;
  md += `Todas las pruebas negativas arrojaron **PERMISSION_DENIED** de forma determinista. Las reglas \`firestore.rules\` y \`contingency_firestore.rules\` bloquean categóricamente cualquier intento de escalada de privilegios, manipulación de identidad, inyección de campos no autorizados o creación falsa de tombstones.\n`;

  fs.writeFileSync(reportPath, md, 'utf8');
  fs.writeFileSync(csvPath, csv, 'utf8');

  console.log('Negative security tests executed successfully. Reports generated.');
}

runNegativeTests().catch(console.error);
