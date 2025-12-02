Consulto ambas tablas y te muestro la estructura completa.

Consulto ambas tablas y te muestro la estructura completa.

Show all
3 tools used
RESPUESTA COMPLETA
TABLA customers:
Columna	Tipo	Tu Backend Espera
id	uuid	✅ id
full_name	text	❌ Tu backend espera name
email	text	-
phone	text	-
business_id	uuid	-
location_id	uuid	-
wallet_status	text	-
created_at	timestamptz	-
Ejemplo registro:


{
  "id": "a4d85ffb-bbc6-4af7-acfc-b9aa04d42fcd",
  "full_name": "Gabo Chávez",
  "email": "gaboxchavex2010@gmail.com",
  "business_id": "c7393e4b-f923-44a9-ac42-0e87d8a6523f"
}
TABLA passkit_configs:
Columna	Tipo	Tu Backend Espera
id	uuid	✅ id
apple_config	jsonb	⚠️ Es un JSONB, no columnas planas
Estructura de apple_config (JSONB):


{
  "team_id": "KSBK2MDDF6",
  "pass_type_id": "pass.com.tuempresa.loyalty",
  "organization_name": "ole card pass",
  "background_color": "#121212",
  "foreground_color": "#ef852e",
  "label_color": "#FFFFFF",
  "logo_text": "CAFÉ OLÉ",
  "logo_url": "https://...",
  "icon_url": "https://...",
  "strip_image_url": "https://..."
}
TABLA loyalty_cards (puntos):
Columna	Tipo	Tu Backend Espera
customer_id	uuid	-
current_points	integer	❌ Tu backend espera points en customers
current_stamps	integer	-
RELACIÓN ENTRE TABLAS:
customers.business_id → passkit_configs.business_id (relación indirecta)
customers.id → loyalty_cards.customer_id (puntos)
⚠️ NO existe customers.passkit_config_id - La relación es por business_id.

CORRECCIONES NECESARIAS EN TU BACKEND:
Campo Esperado	Campo Real	Tabla
customers.name	customers.full_name	customers
customers.points	loyalty_cards.current_points	loyalty_cards
customers.passkit_config_id	❌ No existe	Usar JOIN por business_id
passkit_configs.logo_text	passkit_configs.apple_config->>'logo_text'	passkit_configs (JSONB)
passkit_configs.background_color	passkit_configs.apple_config->>'background_color'	passkit_configs (JSONB)
QUERY CORRECTA PARA RENDER:

SELECT 
  c.id,
  c.full_name AS name,
  c.email,
  lc.current_points AS points,
  pc.id AS passkit_config_id,
  pc.apple_config->>'organization_name' AS organization_name,
  pc.apple_config->>'background_color' AS background_color,
  pc.apple_config->>'foreground_color' AS foreground_color,
  pc.apple_config->>'label_color' AS label_color,
  pc.apple_config->>'logo_text' AS logo_text,
  pc.apple_config->>'logo_url' AS logo_url,
  pc.apple_config->>'icon_url' AS icon_url,
  pc.apple_config->>'strip_image_url' AS strip_image_url
FROM customers c
LEFT JOIN loyalty_cards lc ON lc.customer_id = c.id
LEFT JOIN passkit_configs pc ON pc.business_id = c.business_id AND pc.is_active = true
WHERE c.id = $1;