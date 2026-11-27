INSERT INTO site_settings (key, value, is_public) VALUES
  ('feature_flags', '{"signup":false,"myDistrict":false,"articles":false,"notifications":false}', true)
ON CONFLICT (key) DO NOTHING;
