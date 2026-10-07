// Contexte d'authentification et lecteurs légers (sans dépendance réseau ni push) :
// importables partout, y compris par hooks.js, sans charger auth.jsx et ses effets.
import { createContext, useContext } from "react";
import { modulesOf } from "./lib/modules";
import { userCity, cityById } from "./lib/cities";

export const AuthContext = createContext(null);

/**
 * Fonctionnalités actives du compte : { bikes, trains }. Hors <AuthProvider> (pages
 * publiques, composants isolés) : les deux, comportement par défaut.
 */
export const useModules = () => modulesOf(useContext(AuthContext)?.user);

/**
 * Ville des vélos du compte : { id, name, system, country, center, website } (lib/cities.js).
 * Hors <AuthProvider> : Amiens.
 */
export const useBikeCity = () => cityById(userCity(useContext(AuthContext)?.user));
