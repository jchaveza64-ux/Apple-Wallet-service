-- Schema para Apple Wallet + Loyalty Cards
-- Ejecuta este SQL en tu Supabase SQL Editor

-- Tabla para almacenar puntos de lealtad de usuarios
CREATE TABLE IF NOT EXISTS loyalty_points (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  points INTEGER DEFAULT 0,
  tier TEXT DEFAULT 'Básico',
  name TEXT,
  email TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Tabla para almacenar los passes generados
CREATE TABLE IF NOT EXISTS wallet_passes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT NOT NULL,
  serial_number TEXT NOT NULL UNIQUE,
  auth_token TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Tabla para almacenar dispositivos registrados (para push notifications)
CREATE TABLE IF NOT EXISTS wallet_devices (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  device_library_identifier TEXT NOT NULL,
  push_token TEXT NOT NULL,
  pass_type_identifier TEXT NOT NULL,
  serial_number TEXT NOT NULL,
  user_id TEXT NOT NULL,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  UNIQUE(device_library_identifier, serial_number)
);

-- Índices para mejorar performance
CREATE INDEX IF NOT EXISTS idx_wallet_passes_user_id ON wallet_passes(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_passes_serial_number ON wallet_passes(serial_number);
CREATE INDEX IF NOT EXISTS idx_wallet_devices_serial_number ON wallet_devices(serial_number);
CREATE INDEX IF NOT EXISTS idx_wallet_devices_device_identifier ON wallet_devices(device_library_identifier);
CREATE INDEX IF NOT EXISTS idx_loyalty_points_user_id ON loyalty_points(user_id);

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc'::text, NOW());
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers para actualizar updated_at
DROP TRIGGER IF EXISTS update_loyalty_points_updated_at ON loyalty_points;
CREATE TRIGGER update_loyalty_points_updated_at
  BEFORE UPDATE ON loyalty_points
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_wallet_passes_updated_at ON wallet_passes;
CREATE TRIGGER update_wallet_passes_updated_at
  BEFORE UPDATE ON wallet_passes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Políticas de seguridad (Row Level Security)
-- Ajusta según tu configuración de autenticación en Lovable

ALTER TABLE loyalty_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_passes ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_devices ENABLE ROW LEVEL SECURITY;

-- Política para que el servicio backend pueda acceder (usando service_role_key)
CREATE POLICY "Service role can do everything on loyalty_points"
  ON loyalty_points FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can do everything on wallet_passes"
  ON wallet_passes FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role can do everything on wallet_devices"
  ON wallet_devices FOR ALL
  USING (true)
  WITH CHECK (true);

-- Si quieres permitir acceso desde tu app Lovable (usando anon_key)
-- Descomentar y ajustar según tus necesidades:

-- CREATE POLICY "Users can view their own loyalty points"
--   ON loyalty_points FOR SELECT
--   USING (auth.uid()::text = user_id);

-- CREATE POLICY "Users can view their own passes"
--   ON wallet_passes FOR SELECT
--   USING (auth.uid()::text = user_id);

-- Datos de ejemplo (opcional)
-- INSERT INTO loyalty_points (user_id, points, tier, name, email) VALUES
-- ('user123', 1500, 'Oro', 'Juan Pérez', 'juan@example.com'),
-- ('user456', 500, 'Plata', 'María García', 'maria@example.com');

-- Comentarios
COMMENT ON TABLE loyalty_points IS 'Almacena los puntos de lealtad de cada usuario';
COMMENT ON TABLE wallet_passes IS 'Almacena información de los passes de Apple Wallet generados';
COMMENT ON TABLE wallet_devices IS 'Almacena dispositivos registrados para recibir notificaciones push';
