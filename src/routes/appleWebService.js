/**
 * Genera un pass actualizado
 */
async function generateUpdatedPass(serialNumber) {
  // INICIALIZAR CERTIFICADOS PRIMERO
  await certificateManager.initialize();
  
  // Buscar el customer por card_number (serialNumber)
  const { data: loyaltyCard, error: cardError } = await supabase
    .from('loyalty_cards')
    .select(`
      *,
      customers (
        id,
        full_name,
        email,
        phone,
        business_id
      )
    `)
    .eq('card_number', serialNumber)
    .single();

  if (cardError || !loyaltyCard) {
    throw new Error('Loyalty card not found');
  }

  const customer = Array.isArray(loyaltyCard.customers) 
    ? loyaltyCard.customers[0] 
    : loyaltyCard.customers;

  // Obtener configuración
  const { data: formConfigs } = await supabase
    .from('form_configurations')
    .select('*, passkit_configs(*)')
    .eq('business_id', customer.business_id)
    .limit(1);

  if (!formConfigs || formConfigs.length === 0) {
    throw new Error('Config not found');
  }

  const passkitConfig = formConfigs[0].passkit_configs;
  const appleConfig = passkitConfig.apple_config || {};
  const memberFields = passkitConfig.member_fields || [];
  const barcodeConfig = passkitConfig.barcode_config || {};
  const linksFields = passkitConfig.links_fields || [];
  const customFields = passkitConfig.custom_fields || [];

  // Descargar imágenes
  const templatePath = path.join(__dirname, '../templates/loyalty.pass');

  if (appleConfig.logo_url) {
    await downloadImage(appleConfig.logo_url, path.join(templatePath, 'logo.png'));
    await downloadImage(appleConfig.logo_url, path.join(templatePath, 'logo@2x.png'));
    await downloadImage(appleConfig.logo_url, path.join(templatePath, 'logo@3x.png'));
  }