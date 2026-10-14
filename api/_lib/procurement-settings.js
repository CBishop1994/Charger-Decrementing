/**
 * Load / ensure singleton procurement_settings row (id=1).
 */

import { supabaseAdmin } from "./supabase-admin.js";
import {
  DEFAULT_JIRA_DESCRIPTION,
  DEFAULT_JIRA_SUMMARY,
} from "./procurement-template.js";

export async function ensureProcurementSettings() {
  const { data: existing, error } = await supabaseAdmin
    .from("procurement_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (error) throw error;
  if (existing) return existing;

  const { data, error: insertErr } = await supabaseAdmin
    .from("procurement_settings")
    .insert({
      id: 1,
      jira_summary_template: DEFAULT_JIRA_SUMMARY,
      jira_description_template: DEFAULT_JIRA_DESCRIPTION,
      slack_channel_id: "",
      slack_ping_user_id: "",
      jira_project_key: "",
      jira_issue_type: "",
      updated_by: "system",
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  // Race: another request inserted first
  if (insertErr) {
    const { data: again, error: againErr } = await supabaseAdmin
      .from("procurement_settings")
      .select("*")
      .eq("id", 1)
      .maybeSingle();
    if (againErr) throw againErr;
    if (again) return again;
    throw insertErr;
  }
  return data;
}

/**
 * Resolved routing: DB overrides win when non-empty, else env.
 * @param {Record<string, unknown>} settings
 */
export function resolveProcurementRouting(settings) {
  const slackChannelId =
    String(settings?.slack_channel_id ?? "").trim() ||
    String(process.env.SLACK_CHANNEL_ID ?? "").trim();
  const slackPingUserId =
    String(settings?.slack_ping_user_id ?? "").trim() ||
    String(process.env.SLACK_PING_USER_ID ?? "").trim();
  const jiraProjectKey =
    String(settings?.jira_project_key ?? "").trim() ||
    String(process.env.JIRA_PROJECT_KEY ?? "").trim();
  const jiraIssueType =
    String(settings?.jira_issue_type ?? "").trim() ||
    String(process.env.JIRA_ISSUE_TYPE ?? "").trim() ||
    "Task";

  return {
    slackChannelId,
    slackPingUserId,
    jiraProjectKey,
    jiraIssueType,
  };
}
