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
      <p>Mox s'appelait VéloPulse jusqu'à la version 1.13 : seul le nom a changé, vos données et vos réglages sont les mêmes.</p>

      <h2>Ce que Mox enregistre</h2>
      <ul>
        <li><b>Votre compte</b> : un nom d'utilisateur et votre mot de passe <b>chiffré</b> (haché, jamais lisible), si vous avez déjà vu le tutoriel de présentation, les fonctionnalités que vous utilisez (vélos, trains), la ville de vos vélos et les types d'alertes que vous souhaitez recevoir. Aucune adresse e-mail, aucun nom réel.</li>
        <li><b>Vos favoris</b> et le nom que vous leur donnez, ainsi que leur ordre.</li>
        <li><b>Vos alertes</b> : stations, seuils, horaires (dont les heures d'envoi de vos résumés), jours, le nom éventuel de vos groupes de stations, et la date de pause éventuelle.</li>
        <li><b>Vos trains</b> : les trajets favoris (gares, ligne, numéro et heure du train, nom éventuel), vos alertes trains (seuil de retard, motifs, jours, créneau) et l'historique des notifications envoyées pendant 45 jours, pour ne jamais vous prévenir deux fois du même événement.</li>
        <li><b>Vos appareils connectés</b> : le type d'appareil et de navigateur (tel que votre navigateur l'annonce), la date de connexion et la dernière activité, pour que vous puissiez les reconnaître et les déconnecter. Un appareil inactif au-delà de la durée de connexion (30 jours) est effacé.</li>
        <li><b>Vos appareils</b> ayant activé les notifications : l'adresse technique fournie par votre navigateur pour vous les envoyer.</li>
      </ul>
      <p>Sur votre appareil, l'application garde votre session, vos préférences (thème, type de vélo, page d'ouverture) et la dernière liste des stations et de vos favoris, pour fonctionner hors ligne. Votre position n'est utilisée que sur votre appareil (tri par proximité, « Autour de moi ») et n'est <b>jamais envoyée</b> au serveur.</p>

      <h2>Ce que Mox ne fait pas</h2>
      <ul>
        <li>Aucune publicité, aucun traceur, aucune mesure d'audience.</li>
        <li>Aucune revente ni cession de données.</li>
        <li>Les polices de caractères sont hébergées par l'application (aucun appel à Google).</li>
      </ul>
      <p>Seule la page <b>Carte</b> fait appel à un service tiers : les fonds de carte sont chargés depuis les serveurs de <b>Mapbox</b>, qui reçoivent donc votre adresse IP lorsque vous l'ouvrez.</p>

      <h2>Finalité et durée</h2>
      <p>Ces données servent uniquement à afficher vos favoris et à vous envoyer vos alertes. Elles sont conservées tant que votre compte existe. Les alertes « aujourd'hui seulement » sont supprimées automatiquement le lendemain.</p>

      <h2>Vos droits</h2>
      <p>Depuis <b>Paramètres › Sécurité</b>, vous pouvez changer votre mot de passe, voir et déconnecter vos appareils, <b>télécharger toutes vos données</b> (droit d'accès et à la portabilité) et <b>supprimer votre compte</b> : toutes vos données (favoris, alertes, appareils) sont alors effacées immédiatement et définitivement.</p>

      <h2>Hébergement et sources</h2>
      <p>Application hébergée par Render ; base de données hébergée par Supabase. Les disponibilités des vélos proviennent des flux ouverts (GBFS) des services de vélos en libre-service exploités par Cyclocity (JCDecaux) — Vélam à Amiens, ou la ville que vous choisissez — interrogés par le serveur de Mox. Les horaires et l'information en temps réel des trains proviennent des données ouvertes de SNCF Voyageurs (transport.data.gouv.fr, licence ODbL), interrogées par le serveur de Mox : votre appareil ne contacte jamais la SNCF et aucune donnée vous concernant ne lui est transmise. Mox est un projet indépendant, non affilié à ces services, à JCDecaux ni aux collectivités.</p>
      <p className="legal-todo">Éditeur et contact : à compléter par le responsable du service.</p>

      <p><Link to={isAuthenticated ? "/compte" : "/login"}>← Retour</Link></p>
    </div>
  );
}
