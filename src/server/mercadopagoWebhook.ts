import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { Resend } from 'resend';
import { getAdminServices } from './firebaseAdminServer.ts';

// In-memory cache to immediately eliminate duplicate webhook bursts
const inMemoryProcessedPayments = new Set<string>();

export interface MercadoPagoPaymentDetails {
  paymentId: string;
  status: string;
  payerEmail: string;
  payerName: string;
  amount?: number;
  currencyId?: string;
}

/**
 * Resolves payment details either from the webhook request body directly
 * or by querying the Mercado Pago REST API if an Access Token is configured.
 */
async function resolvePaymentDetails(
  req: Request,
  paymentId: string
): Promise<MercadoPagoPaymentDetails | null> {
  const body = req.body || {};

  // 1. Check if the webhook payload already contains full payment details (direct or simulated)
  if (body.payer && (body.payer.email || body.payer.name)) {
    const firstName = body.payer.first_name || '';
    const lastName = body.payer.last_name || '';
    const fullName = `${firstName} ${lastName}`.trim() || body.payer.name || 'Atleta';
    return {
      paymentId: String(paymentId),
      status: body.status || 'approved',
      payerEmail: (body.payer.email || '').trim().toLowerCase(),
      payerName: fullName,
      amount: body.transaction_amount,
      currencyId: body.currency_id,
    };
  }

  // 2. Query Mercado Pago Payments API if Access Token is configured
  const mpAccessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (mpAccessToken) {
    try {
      const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: {
          Authorization: `Bearer ${mpAccessToken}`,
          'Content-Type': 'application/json',
        },
      });

      if (response.ok) {
        const data = await response.json();
        const firstName = data.payer?.first_name || data.additional_info?.payer?.first_name || '';
        const lastName = data.payer?.last_name || data.additional_info?.payer?.last_name || '';
        const fullName = `${firstName} ${lastName}`.trim() || data.payer?.name || 'Atleta';
        const email = (data.payer?.email || data.additional_info?.payer?.email || '').trim().toLowerCase();

        return {
          paymentId: String(data.id || paymentId),
          status: data.status || 'unknown',
          payerEmail: email,
          payerName: fullName,
          amount: data.transaction_amount,
          currencyId: data.currency_id,
        };
      } else {
        console.warn(`[MercadoPago Webhook] Failed to fetch payment ${paymentId}: ${response.status} ${response.statusText}`);
      }
    } catch (err) {
      console.error(`[MercadoPago Webhook] Network error fetching payment ${paymentId}:`, err);
    }
  }

  // 3. Fallback for test / sandbox payloads with partial structure
  if (body.data?.payer_email || body.payer_email) {
    return {
      paymentId: String(paymentId),
      status: body.data?.status || body.status || 'approved',
      payerEmail: (body.data?.payer_email || body.payer_email).trim().toLowerCase(),
      payerName: body.data?.payer_name || body.payer_name || 'Atleta',
    };
  }

  return null;
}

/**
 * Builds the responsive HTML template for the automated activation email.
 */
function buildActivationEmailHtml(
  payerName: string,
  token: string,
  activationUrl: string
): string {
  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tu Código de Acceso a LAZCAKONGYM PRO</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #070a11;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #f1f5f9;
    }
    .wrapper {
      width: 100%;
      background-color: #070a11;
      padding: 30px 15px;
      box-sizing: border-box;
    }
    .card {
      max-width: 540px;
      margin: 0 auto;
      background: linear-gradient(180deg, #0d1424 0%, #080d18 100%);
      border: 1px solid rgba(245, 158, 11, 0.35);
      border-radius: 24px;
      padding: 36px 28px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.7);
    }
    .badge {
      display: inline-block;
      background-color: rgba(245, 158, 11, 0.15);
      border: 1px solid rgba(245, 158, 11, 0.35);
      color: #f59e0b;
      font-size: 11px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      padding: 6px 14px;
      border-radius: 9999px;
      margin-bottom: 18px;
    }
    h1 {
      font-size: 24px;
      font-weight: 900;
      color: #ffffff;
      margin: 0 0 12px 0;
      letter-spacing: -0.5px;
    }
    p {
      font-size: 14px;
      line-height: 1.6;
      color: #94a3b8;
      margin: 0 0 22px 0;
    }
    .code-box {
      background-color: #030712;
      border: 2px dashed #f59e0b;
      border-radius: 16px;
      padding: 20px;
      text-align: center;
      margin: 24px 0;
    }
    .code-label {
      font-size: 11px;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 1px;
      font-weight: 700;
      margin-bottom: 8px;
    }
    .code-value {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 24px;
      font-weight: 900;
      color: #f59e0b;
      letter-spacing: 2px;
    }
    .cta-button {
      display: block;
      background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%);
      color: #030712 !important;
      text-decoration: none;
      font-size: 15px;
      font-weight: 900;
      text-align: center;
      padding: 16px 28px;
      border-radius: 14px;
      box-shadow: 0 10px 25px rgba(245, 158, 11, 0.35);
      margin: 28px 0;
    }
    .steps {
      background-color: rgba(15, 23, 42, 0.6);
      border: 1px solid rgba(51, 65, 85, 0.6);
      border-radius: 16px;
      padding: 20px;
      margin-top: 24px;
    }
    .step-item {
      display: flex;
      align-items: flex-start;
      margin-bottom: 12px;
      font-size: 12px;
      color: #cbd5e1;
      line-height: 1.5;
    }
    .step-number {
      background-color: #f59e0b;
      color: #030712;
      font-weight: 900;
      font-size: 11px;
      border-radius: 50%;
      width: 20px;
      height: 20px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      margin-right: 10px;
      flex-shrink: 0;
    }
    .footer {
      text-align: center;
      font-size: 11px;
      color: #64748b;
      margin-top: 24px;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="card">
      <div style="text-align: center;">
        <span class="badge">Pago Confirmado · Membresía PRO</span>
        <h1>¡Bienvenido a LAZCAKONGYM, ${payerName}! 🦍🔥</h1>
        <p>Tu pago ha sido procesado exitosamente por Mercado Pago. A continuación tienes tu código de acceso personal e intransferible.</p>
      </div>

      <div class="code-box">
        <div class="code-label">Tu Código de Acceso Único (1 Solo Uso)</div>
        <div class="code-value">${token}</div>
      </div>

      <a href="${activationUrl}" class="cta-button" target="_blank">
        ⚡ ACTIVAR MI MEMBRESÍA AHORA
      </a>

      <div class="steps">
        <div style="font-weight: 800; font-size: 13px; color: #ffffff; margin-bottom: 12px;">Instrucciones de Activación:</div>
        <div class="step-item">
          <span class="step-number">1</span>
          <span>Haz clic en el botón superior o entra a la app y pulsa <strong>"Activar Membresía"</strong>.</span>
        </div>
        <div class="step-item">
          <span class="step-number">2</span>
          <span>Ingresa tu código único si no se carga de forma automática.</span>
        </div>
        <div class="step-item">
          <span class="step-number">3</span>
          <span>Define tu nombre de atleta y crea tu <strong>PIN de 4 dígitos</strong>. El código se quemará automáticamente tras su primer uso.</span>
        </div>
      </div>

      <div class="footer">
        Este código es personal, confidencial y de 1 solo uso.<br>
        © ${new Date().getFullYear()} LAZCAKONGYM PRO · Coach Camilo Lazcano.
      </div>
    </div>
  </div>
</body>
</html>
  `.trim();
}

/**
 * Express Route Handler: POST /api/webhooks/mercadopago
 */
export async function handleMercadoPagoWebhook(req: Request, res: Response): Promise<void> {
  try {
    // Mercado Pago sends ID in req.body.data.id or req.body.id or req.query.id / req.query['data.id']
    const rawPaymentId =
      req.body?.data?.id ||
      req.body?.id ||
      req.query?.['data.id'] ||
      req.query?.id ||
      req.body?.resource?.split('/').pop();

    if (!rawPaymentId) {
      console.warn('[MercadoPago Webhook] Notification received without payment ID:', {
        body: req.body,
        query: req.query,
      });
      res.status(400).json({ error: 'Missing payment id in webhook notification' });
      return;
    }

    const paymentId = String(rawPaymentId).trim();

    // 1. In-memory deduplication check
    if (inMemoryProcessedPayments.has(paymentId)) {
      console.log(`[MercadoPago Webhook] Duplicate payment ignored (in-memory cache): ${paymentId}`);
      res.status(200).json({ status: 'ignored', message: 'Payment already processed' });
      return;
    }

    // 2. Firestore persistent deduplication check (Admin SDK)
    let adminDb: ReturnType<typeof getAdminServices>['db'] | null = null;
    try {
      adminDb = getAdminServices().db;
    } catch (initErr) {
      console.warn('[MercadoPago Webhook] Warning initializing Firebase Admin SDK:', initErr);
    }

    try {
      if (adminDb) {
        const existingSnap = await adminDb.collection('processed_payments').doc(paymentId).get();
        if (existingSnap.exists) {
          inMemoryProcessedPayments.add(paymentId);
          console.log(`[MercadoPago Webhook] Duplicate payment ignored (Firestore): ${paymentId}`);
          res.status(200).json({
            status: 'ignored',
            message: 'Payment already processed and recorded',
            existingInvite: existingSnap.data()?.inviteToken,
          });
          return;
        }
      }
    } catch (dbErr) {
      console.warn('[MercadoPago Webhook] Warning verifying processed_payments in Firestore:', dbErr);
    }

    // 3. Resolve payment details & verify status
    const payment = await resolvePaymentDetails(req, paymentId);

    if (!payment) {
      console.warn(`[MercadoPago Webhook] Unable to resolve details for payment ID ${paymentId}`);
      // Return 200 so Mercado Pago does not flood retries if payment is still being prepared
      res.status(200).json({ status: 'pending_resolution', paymentId });
      return;
    }

    // 4. Verify payment status is approved
    if (payment.status !== 'approved') {
      console.log(`[MercadoPago Webhook] Payment ${paymentId} status is "${payment.status}". No invite generated.`);
      res.status(200).json({ status: payment.status, message: 'Payment not approved' });
      return;
    }

    const payerEmail = (payment.payerEmail || '').trim().toLowerCase();
    const payerName = payment.payerName || 'Atleta';

    if (!payerEmail) {
      console.warn(`[MercadoPago Webhook] Payment ${paymentId} is approved but missing payer email.`);
      res.status(400).json({ error: 'Approved payment missing payer email' });
      return;
    }

    // 5. Generate Atomic Single-Use Invite Code (LZK-XXXX-XXXX)
    const adminNote = `Mercado Pago #${paymentId} · ${payerName} (${payerEmail})`;
    const randomPart = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
    const timePart = Date.now().toString(36).toUpperCase();
    const token = `LZK-${timePart}-${randomPart}`;
    const newInvite = {
      token,
      createdAt: new Date().toISOString(),
      createdBy: 'Mercado Pago Webhook',
      note: adminNote,
      used: false,
      revoked: false,
    };

    if (adminDb) {
      await adminDb.collection('invites').doc(token).set(newInvite);
    }

    // 6. Record Payment as Processed in Firestore to prevent any future duplicates
    try {
      if (adminDb) {
        await adminDb.collection('processed_payments').doc(paymentId).set({
          paymentId,
          inviteToken: token,
          payerEmail,
          payerName,
          amount: payment.amount || null,
          currencyId: payment.currencyId || 'CLP',
          processedAt: new Date().toISOString(),
          status: 'approved',
        });
      }
      inMemoryProcessedPayments.add(paymentId);
    } catch (saveErr) {
      console.error('[MercadoPago Webhook] Error persisting processed payment:', saveErr);
      inMemoryProcessedPayments.add(paymentId);
    }

    // 7. Dispatch automated email via Resend
    let emailSent = false;
    let emailError: string | null = null;
    const resendApiKey = process.env.RESEND_API_KEY;
    const appUrl = (process.env.APP_URL || 'https://lazcakongym.ai.studio').replace(/\/$/, '');
    const activationUrl = `${appUrl}/?invite=${encodeURIComponent(token)}`;

    if (resendApiKey) {
      try {
        const resend = new Resend(resendApiKey);
        const fromEmail = process.env.RESEND_FROM_EMAIL || 'LAZCAKONGYM <onboarding@resend.dev>';

        const emailResult = await resend.emails.send({
          from: fromEmail,
          to: payerEmail,
          subject: '¡Tu Código de Acceso a LAZCAKONGYM PRO está listo! 🦍🔥',
          html: buildActivationEmailHtml(payerName, token, activationUrl),
        });

        if (emailResult.error) {
          console.error('[MercadoPago Webhook] Resend returned error:', emailResult.error);
          emailError = emailResult.error.message;
        } else {
          console.log(`[MercadoPago Webhook] Automated email dispatched to ${payerEmail} (ID: ${emailResult.data?.id})`);
          emailSent = true;
        }
      } catch (err: any) {
        console.error('[MercadoPago Webhook] Error sending email via Resend:', err);
        emailError = err?.message || 'Error sending email';
      }
    } else {
      console.log(`[MercadoPago Webhook] RESEND_API_KEY is not defined. Email simulated. Code: ${token} for ${payerEmail}`);
    }

    // 8. Return success response to Mercado Pago
    res.status(200).json({
      success: true,
      paymentId,
      status: 'approved',
      payer: {
        name: payerName,
        email: payerEmail,
      },
      inviteToken: token,
      activationUrl,
      emailSent,
      emailError,
    });
  } catch (error: any) {
    console.error('[MercadoPago Webhook] Uncaught error processing webhook:', error);
    res.status(500).json({
      success: false,
      error: error?.message || 'Internal server error processing payment webhook',
    });
  }
}
