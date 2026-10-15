import { useEffect, useState } from "react";

// La hora de ahora, que se actualiza sola al cambiar el minuto (la fecha de
// la franja del Inicio se quedaba con la hora en que se abrió la página).
// Espera al siguiente minuto exacto y de ahí avanza cada 60 s, para que el
// reloj cambie junto con el de la compu y no hasta 59 s después.
export function useAhora() {
  const [ahora, setAhora] = useState(() => new Date());
  useEffect(() => {
    let intervalo: number | undefined;
    const inicio = window.setTimeout(() => {
      setAhora(new Date());
      intervalo = window.setInterval(() => setAhora(new Date()), 60_000);
    }, 60_000 - (Date.now() % 60_000));
    return () => {
      window.clearTimeout(inicio);
      window.clearInterval(intervalo);
    };
  }, []);
  return ahora;
}
