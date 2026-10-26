export const ORGANIZATION_TOOL = {
  name: "organizacao_pessoal",
  description:
    "Manage the user’s personal tasks, Kanban, calendar and explicit reminders in the same Notifica workspace shown in OpenMausBot. Requires owner authorization in Organização → Preferências. First call snapshot to read current preferences, local timezone, records, IDs and versions. Resolve relative dates in that timezone and report absolute dates. Never invent a reminder from a plan, never move a deadline when rescheduling execution, never create a confirmed appointment without start/end. Writes require a stable idempotency_key; retry the exact same request/key after uncertainty. Edits require expected_version from the latest record; preferences/access use organization.version. Confirm saved only after success and report errors/conflicts accurately. Date-only values are YYYY-MM-DD, instants ISO 8601 with offset. No recurring tasks, invitations or external calendar. tasks.create/update data: title, description, next_action, state open/doing/waiting/done, priority 0–3, context, due_date OR due_at (other must be null), estimate_minutes, plan (null or {mode:day,date,timezone}, {mode:period,date,period:morning/afternoon/evening,timezone}, {mode:week,week_start:Monday,timezone}), checklist [{id,title,done}]. plans.set takes the plan as data. tasks.move data.column: Entrada/Esta semana/Hoje/Fazendo/Aguardando/Concluído. tasks.focus data.minutes optional. blocks.create data: task_id,start_at,end_at,timezone,state planned/active; blocks.update may set state done without completing the task. appointments.create/update data: title,start_at,end_at,timezone,location,notes; confirm_overlap only after explicit user acceptance of an overlap. reminders.create data: target_type task/block/appointment,target_id,rule {type:absolute} or {type:relative,minutes_before} or {type:plan,time:HH:mm}, scheduled_at,allow_quiet (true only on explicit user exception); update omits target fields. Completion/archive cancels future notices. Reopen never restores old notices. Reads: snapshot/tasks.get/tasks.list/appointments.list/preferences.get. No owner or bot identity is accepted; the active turn supplies identity. Return links provided by the API.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      operation: {
        type: "string",
        enum: [
          "snapshot",
          "tasks.create",
          "tasks.get",
          "tasks.list",
          "tasks.update",
          "tasks.complete",
          "tasks.reopen",
          "tasks.archive",
          "tasks.move",
          "tasks.focus",
          "plans.set",
          "plans.clear",
          "blocks.create",
          "blocks.update",
          "blocks.cancel",
          "appointments.create",
          "appointments.list",
          "appointments.update",
          "appointments.cancel",
          "reminders.create",
          "reminders.update",
          "reminders.cancel",
          "preferences.get",
          "preferences.update",
        ],
      },
      idempotency_key: {
        type: "string",
        maxLength: 200,
        description:
          "Stable conversation:message:operation identifier for this exact write.",
      },
      id: {
        type: "string",
        description: "Existing record ID; omit on creation.",
      },
      expected_version: { type: "integer", minimum: 0 },
      data: {
        type: "object",
        description:
          "Fields documented for the selected operation; only changes on update.",
      },
    },
    required: ["operation"],
  },
} as const;
