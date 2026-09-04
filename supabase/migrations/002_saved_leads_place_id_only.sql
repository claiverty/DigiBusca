-- Google Places allows indefinite storage of the place_id, but not a permanent
-- snapshot of the remaining Places content. Keep only the identifier in lead_data.
update public.saved_leads
set lead_data = jsonb_build_object('id', lead_id)
where lead_data <> jsonb_build_object('id', lead_id);
