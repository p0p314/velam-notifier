import { Link } from "react-router-dom";
import { useAuth } from "../auth";

/**
 * Confidentialité et mentions légales. Page publique (accessible sans compte).
 * Décrit exactement ce que stocke l'application — à tenir à jour si le modèle
 * de données évolue.
 */
export default function Privacy() {
  const { isAuthenticated } = useAuth();
  return (
    <div className="legal-page">
      <h1 className="page-title">Confidentialité et mentions légales</h1>

      <h2>Ce que VéloPulse enregistre</h2>
      <ul>
        <li><b>Votre compte</b> : un nom d'utilisateur et votre mot de passe <b>chiffré</b> (haché, jamais lisible). Aucune adresse e-mail, aucun nom réel.</li>
        <li><b>Vos favoris</b> et le nom que vous leur donnez, ainsi que leur ordre.</li>
        <li><b>Vos alertes</b> : stations, seuils, horaires, jours, et la date de pause éventuelle.</li>
        <li><b>Vos appareils</b> ayant activé les notifications : l'adresse technique fournie par votre navigateur pour vous les envoyer.</li>
      </ul>
      <p>Sur votre appareil, l'application garde votre session et la dernière liste des stations et de vos favoris, pour fonctionner hors ligne. Votre position n'est utilisée que sur votre appareil (tri par proximité, « Autour de moi ») et n'est <b>jamais envoyée</b> au serveur.</p>

      <h2>Ce que VéloPulse ne fait pas</h2>
      <ul>
        <li>Aucune publicité, aucun traceur, aucune mesure d'audience.</li>
        <li>Aucune revente ni cession de données.</li>
        <li>Les polices de caractères sont hébergées par l'application (aucun appel à Google).</li>
      </ul>
      <p>Seule la page <b>Carte</b> fait appel à un service tiers : les fonds de carte sont chargés depuis les serveurs de <b>Mapbox</b>, qui reçoivent donc votre adresse IP lorsque vous l'ouvrez.</p>

      <h2>Finalité et durée</h2>
      <p>Ces données servent uniquement à afficher vos favoris et à vous envoyer vos alertes. Elles sont conservées tant que votre compte existe. Les alertes « aujourd'hui seulement » sont supprimées automatiquement le lendemain.</p>

      <h2>Vos droits</h2>
      <p>Depuis <b>Mon compte</b>, vous pouvez changer votre mot de passe et <b>supprimer votre compte</b> : toutes vos données (favoris, alertes, appareils) sont alors effacées immédiatement et définitivement.</p>

      <h2>Hébergement et sources</h2>
      <p>Application hébergée par Render ; base de données hébergée par Supabase. Les disponibilités des vélos proviennent du flux ouvert (GBFS) du service Vélam d'Amiens Métropole. VéloPulse est un projet indépendant, non affilié à Vélam ni à Amiens Métropole.</p>
      <p className="legal-todo">Éditeur et contact : à compléter par le responsable du service.</p>

      <p><Link to={isAuthenticated ? "/compte" : "/login"}>← Retour</Link></p>
    </div>
  );
}
