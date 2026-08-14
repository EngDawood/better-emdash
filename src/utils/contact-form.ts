const SUBMIT_ENDPOINT = "/_emdash/api/plugins/emdash-forms/submit";

/**
 * Envelope used by every EmDash plugin route: `{ success: true, data }` on
 * success, `{ success: false, error }` on failure.
 */
interface SubmitResponse {
	success?: boolean;
	data?: { message?: string };
	error?: { code?: string; message?: string };
}

export interface ContactFormOutcome {
	status: "success" | "error";
	/** Confirmation message configured in EmDash, or null to use a translated fallback */
	message: string | null;
}

/**
 * Submit a contact form to the EmDash forms plugin.
 *
 * The plugin's real error (missing form, validation failure, paused form) is
 * logged for Cloudflare observability; callers get a flag they can pair with a
 * translated, visitor-safe message.
 */
export async function submitContactForm(
	requestUrl: URL,
	formId: string,
	data: Record<string, string>,
): Promise<ContactFormOutcome> {
	try {
		const res = await fetch(new URL(SUBMIT_ENDPOINT, requestUrl), {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ formId, data }),
		});

		const body = (await res.json().catch(() => null)) as SubmitResponse | null;

		if (!res.ok || !body?.success) {
			console.error("[contact-form] submission rejected", {
				formId,
				status: res.status,
				code: body?.error?.code ?? null,
				message: body?.error?.message ?? null,
			});
			return { status: "error", message: null };
		}

		return { status: "success", message: body.data?.message ?? null };
	} catch (err) {
		console.error("[contact-form] submission failed", {
			formId,
			error: err instanceof Error ? err.message : String(err),
		});
		return { status: "error", message: null };
	}
}
