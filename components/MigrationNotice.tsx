// Shown while the database lacks the Prompt Chain Tool migration.
export function MigrationNotice() {
  return (
    <div className="notice notice-warn" role="status">
      This database is missing the Prompt Chain Tool tables. Run <span className="mono">supabase/migrations/202611050001_prompt_chain_tool.sql</span> from kaffy811/HumorProject in the Supabase SQL editor, then reload.
    </div>
  );
}
