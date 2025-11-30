/**
 * Ejemplo de integración con Lovable
 * Copia este código en tu proyecto Lovable para integrar Apple Wallet
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

// Configuración - Actualiza con tu URL de Render
const WALLET_SERVICE_URL = 'https://tu-servicio.onrender.com';

/**
 * Hook para manejar Apple Wallet
 */
export function useAppleWallet() {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);

  /**
   * Genera y descarga un pase de Apple Wallet
   */
  const generateWalletPass = async (userId: string, userName: string, userEmail: string) => {
    setIsLoading(true);
    try {
      const response = await fetch(`${WALLET_SERVICE_URL}/api/passes/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          name: userName,
          email: userEmail,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate pass');
      }

      // Descargar el archivo .pkpass
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `loyalty-card-${userId}.pkpass`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast({
        title: '¡Tarjeta generada!',
        description: 'Abre el archivo descargado para agregar la tarjeta a Apple Wallet',
      });

      return true;
    } catch (error) {
      console.error('Error generating wallet pass:', error);
      toast({
        title: 'Error',
        description: 'No se pudo generar la tarjeta. Intenta de nuevo.',
        variant: 'destructive',
      });
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Actualiza los puntos de un usuario y notifica a Apple Wallet
   */
  const updateUserPoints = async (userId: string, newPoints: number, tier?: string) => {
    try {
      // 1. Actualizar en Supabase
      const { error: dbError } = await supabase
        .from('loyalty_points')
        .upsert({
          user_id: userId,
          points: newPoints,
          tier: tier || 'Básico',
          updated_at: new Date().toISOString(),
        });

      if (dbError) throw dbError;

      // 2. Notificar al servicio de wallet para enviar push notification
      await fetch(`${WALLET_SERVICE_URL}/api/webhook/points-updated`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId,
          points: newPoints,
          tier,
        }),
      });

      toast({
        title: '¡Puntos actualizados!',
        description: `Ahora tienes ${newPoints} puntos. Tu tarjeta de Apple Wallet se actualizará automáticamente.`,
      });

      return true;
    } catch (error) {
      console.error('Error updating points:', error);
      toast({
        title: 'Error',
        description: 'No se pudieron actualizar los puntos.',
        variant: 'destructive',
      });
      return false;
    }
  };

  /**
   * Agrega puntos a un usuario (suma a los existentes)
   */
  const addPoints = async (userId: string, pointsToAdd: number) => {
    try {
      // Obtener puntos actuales
      const { data: currentData, error: fetchError } = await supabase
        .from('loyalty_points')
        .select('points, tier')
        .eq('user_id', userId)
        .single();

      if (fetchError && fetchError.code !== 'PGRST116') {
        throw fetchError;
      }

      const currentPoints = currentData?.points || 0;
      const newPoints = currentPoints + pointsToAdd;

      // Calcular nuevo tier según los puntos
      const newTier = calculateTier(newPoints);

      await updateUserPoints(userId, newPoints, newTier);

      return newPoints;
    } catch (error) {
      console.error('Error adding points:', error);
      return null;
    }
  };

  return {
    generateWalletPass,
    updateUserPoints,
    addPoints,
    isLoading,
  };
}

/**
 * Calcula el tier según los puntos
 * Personaliza según tu programa de lealtad
 */
function calculateTier(points: number): string {
  if (points >= 5000) return 'Platino';
  if (points >= 2000) return 'Oro';
  if (points >= 500) return 'Plata';
  return 'Básico';
}

/**
 * Componente: Botón para agregar a Apple Wallet
 */
export function AddToWalletButton() {
  const { generateWalletPass, isLoading } = useAppleWallet();
  const [user, setUser] = useState<any>(null);

  // Obtener usuario actual (ajusta según tu auth)
  useState(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
    });
  }, []);

  const handleClick = async () => {
    if (!user) {
      toast({
        title: 'Inicia sesión',
        description: 'Debes iniciar sesión para agregar la tarjeta.',
        variant: 'destructive',
      });
      return;
    }

    await generateWalletPass(
      user.id,
      user.user_metadata?.name || user.email?.split('@')[0] || 'Usuario',
      user.email || ''
    );
  };

  return (
    <Button
      onClick={handleClick}
      disabled={isLoading}
      className="w-full"
    >
      {isLoading ? 'Generando...' : 'Agregar a Apple Wallet'}
    </Button>
  );
}

/**
 * Componente: Card de Puntos con integración de Wallet
 */
export function LoyaltyPointsCard() {
  const { addPoints } = useAppleWallet();
  const [points, setPoints] = useState(0);
  const [tier, setTier] = useState('Básico');
  const [user, setUser] = useState<any>(null);

  // Cargar puntos del usuario
  useState(() => {
    const loadUserPoints = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      setUser(user);

      const { data, error } = await supabase
        .from('loyalty_points')
        .select('points, tier')
        .eq('user_id', user.id)
        .single();

      if (data) {
        setPoints(data.points || 0);
        setTier(data.tier || 'Básico');
      }
    };

    loadUserPoints();
  }, []);

  // Ejemplo: Agregar puntos por compra
  const handlePurchase = async (amount: number) => {
    if (!user) return;

    // 1 punto por cada $1 gastado (ajusta según tu lógica)
    const pointsToAdd = Math.floor(amount);
    const newPoints = await addPoints(user.id, pointsToAdd);

    if (newPoints !== null) {
      setPoints(newPoints);
      setTier(calculateTier(newPoints));
    }
  };

  return (
    <div className="p-6 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg text-white">
      <h2 className="text-2xl font-bold mb-2">Programa de Lealtad</h2>
      <div className="mb-4">
        <p className="text-4xl font-bold">{points.toLocaleString()}</p>
        <p className="text-sm opacity-90">Puntos disponibles</p>
      </div>
      <div className="mb-4">
        <p className="text-lg font-semibold">{tier}</p>
        <p className="text-sm opacity-90">Nivel actual</p>
      </div>
      <AddToWalletButton />

      {/* Ejemplo de botón para probar agregar puntos */}
      <Button
        onClick={() => handlePurchase(100)}
        variant="outline"
        className="w-full mt-2"
      >
        Simular compra de $100
      </Button>
    </div>
  );
}

/**
 * Función auxiliar: Obtener información del pass de un usuario
 */
export async function getUserWalletPass(userId: string) {
  try {
    const response = await fetch(`${WALLET_SERVICE_URL}/api/passes/${userId}`);
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.error('Error fetching wallet pass:', error);
    return null;
  }
}

/**
 * Función auxiliar: Verificar si el usuario tiene un pass
 */
export async function hasWalletPass(userId: string): Promise<boolean> {
  const pass = await getUserWalletPass(userId);
  return pass !== null;
}
